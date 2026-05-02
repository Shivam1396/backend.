require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Ensure uploads directory ─────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ─── Multer config ────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Schemas ──────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true },
  password:    { type: String, required: true },
  role:        { type: String, enum: ['student', 'faculty'], required: true },
  firstName:   String,
  lastName:    String,
  email:       String,
  department:  String,
  designation: String,
  createdAt:   { type: Date, default: Date.now }
});

const submissionSchema = new mongoose.Schema({
  studentId:   { type: String, required: true },
  studentName: String,
  title:       { type: String, required: true },
  type:        String,
  department:  String,
  semester:    String,
  notes:       String,
  urgent:      { type: Boolean, default: false },
  fileName:    String,
  filePath:    String,
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentStep: { type: Number, default: 0 },
  facultyChain: [{
    facultyId:       String,
    status:          { type: String, enum: ['pending', 'approved', 'rejected', 'waiting'], default: 'waiting' },
    rejectionReason: String,
    signedAt:        Date
  }],
  rejectionReason: String,
  signedAt:        Date,
  submittedAt:     { type: Date, default: Date.now }
});

const User       = mongoose.model('User', userSchema);
const Submission = mongoose.model('Submission', submissionSchema);

// ─── MongoDB Connection ───────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });

// ─── Middleware ───────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'apoorv-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 24 * 60 * 60
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ─── Static Files ─────────────────────────────────────
// Serve the public folder at root — so login.html, signup.html etc.
// are accessible as /login.html, /signup.html (not /public/login.html)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── Auth Middleware ──────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ message: 'Not authenticated' });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session?.user)              return res.status(401).json({ message: 'Not authenticated' });
    if (req.session.user.role !== role)  return res.status(403).json({ message: 'Forbidden' });
    next();
  };
}

// ─── Root Route ───────────────────────────────────────
// Opens index.html first; if already logged in redirect to dashboard
app.get('/', (req, res) => {
  if (req.session?.user) {
    return res.redirect(
      req.session.user.role === 'faculty' ? '/teacher.html' : '/student.html'
    );
  }
  // Serve the landing index page
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── REGISTER (signup.html calls /api/auth/signup) ────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password, role, firstName, lastName,
            email, department, designation } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const existing = await User.findOne({ username: username.toUpperCase() });
    if (existing) return res.status(409).json({ message: 'User already exists' });

    // Derive role from username pattern if not explicitly provided
    let resolvedRole = role;
    if (!resolvedRole) {
      resolvedRole = /^FAC\d{4}$/i.test(username) ? 'faculty' : 'student';
    }

    const hashed = await bcrypt.hash(password, 12);

    await User.create({
      username:    username.toUpperCase(),
      password:    hashed,
      role:        resolvedRole,
      firstName:   firstName || '',
      lastName:    lastName  || '',
      email:       email     || '',
      department:  department  || '',
      designation: designation || ''
    });

    res.json({ message: 'Account created successfully' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// Keep old /register endpoint as alias so nothing breaks
app.post('/api/auth/register', (req, res, next) => {
  req.url = '/api/auth/signup';
  next('route');
});

// ─── LOGIN ────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const user = await User.findOne({ username: username.toUpperCase() });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    // Store a plain object (not mongoose doc) in session
    req.session.user = {
      _id:         user._id.toString(),
      username:    user.username,
      role:        user.role,
      firstName:   user.firstName,
      lastName:    user.lastName,
      email:       user.email,
      department:  user.department,
      designation: user.designation
    };

    res.json({
      message:  'Login successful',
      redirect: user.role === 'faculty' ? '/teacher.html' : '/student.html'
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// ─── ME (get current session user) ───────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ─── LOGOUT ──────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// ════════════════════════════════════════════════════════
//   SUBMISSION ROUTES
// ════════════════════════════════════════════════════════

// ─── STUDENT: Submit a document ──────────────────────
app.post(
  '/api/submissions/student/submit',
  requireRole('student'),
  upload.single('file'),
  async (req, res) => {
    try {
      const { title, type, department, semester, notes, urgent, facultyIds } = req.body;

      if (!title)      return res.status(400).json({ message: 'Title is required' });
      if (!facultyIds) return res.status(400).json({ message: 'Faculty reviewer(s) required' });

      const ids = facultyIds.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (!ids.length)  return res.status(400).json({ message: 'At least one faculty ID required' });

      // Validate all faculty IDs exist
      for (const fid of ids) {
        const fac = await User.findOne({ username: fid, role: 'faculty' });
        if (!fac) return res.status(404).json({ message: `Faculty ID not found: ${fid}` });
      }

      const u = req.session.user;
      const studentName = (u.firstName && u.lastName)
        ? `${u.firstName} ${u.lastName}`
        : u.username;

      const facultyChain = ids.map((fid, i) => ({
        facultyId: fid,
        status:    i === 0 ? 'pending' : 'waiting'
      }));

      const sub = await Submission.create({
        studentId:   u.username,
        studentName,
        title,
        type:        type       || '',
        department:  department || '',
        semester:    semester   || '',
        notes:       notes      || '',
        urgent:      urgent === 'true' || urgent === true,
        fileName:    req.file ? req.file.originalname : '',
        filePath:    req.file ? `/uploads/${req.file.filename}` : '',
        facultyChain,
        currentStep: 0,
        status:      'pending'
      });

      res.json({ message: 'Submitted successfully', submission: sub });
    } catch (err) {
      console.error('Submit error:', err);
      res.status(500).json({ message: 'Submission failed' });
    }
  }
);

// ─── STUDENT: My submissions ──────────────────────────
app.get('/api/submissions/student/my', requireRole('student'), async (req, res) => {
  try {
    const subs = await Submission
      .find({ studentId: req.session.user.username })
      .sort({ submittedAt: -1 });
    res.json(subs);
  } catch (err) {
    console.error('Fetch my subs error:', err);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// ─── FACULTY: Get pending/all submissions for this faculty ────
app.get('/api/submissions/faculty/pending', requireRole('faculty'), async (req, res) => {
  try {
    const facId = req.session.user.username;
    // Return all submissions where this faculty is anywhere in the chain
    const subs = await Submission
      .find({ 'facultyChain.facultyId': facId })
      .sort({ urgent: -1, submittedAt: -1 });
    res.json(subs);
  } catch (err) {
    console.error('Faculty fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// ─── FACULTY: Approve ─────────────────────────────────
app.put('/api/submissions/faculty/:id/approve', requireRole('faculty'), async (req, res) => {
  try {
    const facId = req.session.user.username;
    const sub   = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });

    const step = sub.facultyChain[sub.currentStep];
    if (!step || step.facultyId !== facId) {
      return res.status(403).json({ message: 'Not your turn to review' });
    }
    if (step.status !== 'pending') {
      return res.status(400).json({ message: 'Already reviewed' });
    }

    // Mark this step approved
    sub.facultyChain[sub.currentStep].status   = 'approved';
    sub.facultyChain[sub.currentStep].signedAt = new Date();

    const nextStep = sub.currentStep + 1;

    if (nextStep >= sub.facultyChain.length) {
      // All faculty have signed — fully approved
      sub.status      = 'approved';
      sub.signedAt    = new Date();
      sub.currentStep = nextStep;
    } else {
      // Move to next faculty
      sub.currentStep = nextStep;
      sub.facultyChain[nextStep].status = 'pending';
    }

    sub.markModified('facultyChain');
    await sub.save();

    res.json({ message: 'Approved successfully', submission: sub });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ message: 'Approval failed' });
  }
});

// ─── FACULTY: Reject ──────────────────────────────────
app.put('/api/submissions/faculty/:id/reject', requireRole('faculty'), async (req, res) => {
  try {
    const facId  = req.session.user.username;
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Rejection reason required' });

    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Submission not found' });

    const step = sub.facultyChain[sub.currentStep];
    if (!step || step.facultyId !== facId) {
      return res.status(403).json({ message: 'Not your turn to review' });
    }
    if (step.status !== 'pending') {
      return res.status(400).json({ message: 'Already reviewed' });
    }

    sub.facultyChain[sub.currentStep].status          = 'rejected';
    sub.facultyChain[sub.currentStep].rejectionReason = reason;
    sub.facultyChain[sub.currentStep].signedAt        = new Date();

    sub.status          = 'rejected';
    sub.rejectionReason = reason;

    sub.markModified('facultyChain');
    await sub.save();

    res.json({ message: 'Rejected', submission: sub });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ message: 'Rejection failed' });
  }
});

// ─── Catch-all: redirect unknown routes to / ─────────
app.use((req, res) => {
  res.redirect('/');
});

// ─── Start Server ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
  console.log(`📂 Uploads directory: ${uploadsDir}`);
});