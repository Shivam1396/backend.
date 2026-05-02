const router     = require('express').Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const Submission = require('../models/Submission');

// ── Multer setup ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(file.originalname))
      cb(null, true);
    else
      cb(new Error('Only PDF, DOC, DOCX, JPG, PNG allowed'));
  },
});

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ message: 'Not authenticated.' });
}

function requireStudent(req, res, next) {
  if (req.session?.user?.role === 'student') return next();
  return res.status(403).json({ message: 'Students only.' });
}

function requireFaculty(req, res, next) {
  if (req.session?.user?.role === 'faculty') return next();
  return res.status(403).json({ message: 'Faculty only.' });
}

// ════════════════════════════════════════════════════════════════════════════
// STUDENT ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/submissions/student/submit
router.post('/student/submit', requireAuth, requireStudent, upload.single('file'), async (req, res) => {
  try {
    const { title, type, department, semester, notes, urgent, facultyIds } = req.body;
    const user = req.session.user;

    if (!title)      return res.status(400).json({ message: 'Document title is required.' });
    if (!facultyIds) return res.status(400).json({ message: 'Faculty reviewer(s) are required.' });
    if (!req.file)   return res.status(400).json({ message: 'File is required.' });

    // Build faculty chain
    const ids = facultyIds.split(',').map(id => id.trim().toUpperCase()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ message: 'At least one faculty ID is required.' });

    const facultyChain = ids.map(id => ({ facultyId: id, status: 'pending' }));

    const submission = await Submission.create({
      studentId:    user.username,
      studentName:  `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      title,
      type:         type || '',
      department:   department || '',
      semester:     semester  || '',
      notes:        notes     || '',
      urgent:       urgent === 'true' || urgent === true,
      fileName:     req.file.originalname,
      filePath:     `/uploads/${req.file.filename}`,
      facultyChain,
      status:       'pending',
      currentStep:  0,
    });

    return res.status(201).json({ message: 'Submitted successfully!', submission });
  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ message: 'Server error during submission.' });
  }
});

// GET /api/submissions/student/my
router.get('/student/my', requireAuth, requireStudent, async (req, res) => {
  try {
    const subs = await Submission.find({ studentId: req.session.user.username })
      .sort({ submittedAt: -1 })
      .lean();
    return res.json(subs);
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching submissions.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FACULTY ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/submissions/faculty/pending
// Returns ALL submissions where this faculty's ID appears in the chain
router.get('/faculty/pending', requireAuth, requireFaculty, async (req, res) => {
  try {
    const facultyId = req.session.user.username.toUpperCase();

    // Find submissions where this faculty is in the chain
    const subs = await Submission.find({
      'facultyChain.facultyId': facultyId,
    }).sort({ urgent: -1, submittedAt: -1 }).lean();

    // Attach per-faculty status for this specific faculty member
    const result = subs.map(sub => {
      const myStep = sub.facultyChain.find(s => s.facultyId === facultyId);
      return {
        ...sub,
        // What is MY status in this chain (not overall)
        myStatus: myStep ? myStep.status : 'pending',
        // Only show as pending for THIS faculty if it's their turn
        status: myStep ? myStep.status : sub.status,
        signedAt: myStep?.signedAt || null,
        rejectionReason: myStep?.rejectionReason || null,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('Faculty fetch error:', err);
    return res.status(500).json({ message: 'Error fetching submissions.' });
  }
});

// PUT /api/submissions/faculty/:id/approve
router.put('/faculty/:id/approve', requireAuth, requireFaculty, async (req, res) => {
  try {
    const facultyId = req.session.user.username.toUpperCase();
    const sub = await Submission.findById(req.params.id);

    if (!sub) return res.status(404).json({ message: 'Submission not found.' });

    // Find this faculty's step in the chain
    const stepIndex = sub.facultyChain.findIndex(s => s.facultyId === facultyId);
    if (stepIndex === -1)
      return res.status(403).json({ message: 'You are not in the reviewer chain for this submission.' });

    if (sub.facultyChain[stepIndex].status !== 'pending')
      return res.status(400).json({ message: 'You have already acted on this submission.' });

    // Mark this step approved
    sub.facultyChain[stepIndex].status   = 'approved';
    sub.facultyChain[stepIndex].signedAt = new Date();

    // Check if ALL steps are approved → overall approved
    const allApproved = sub.facultyChain.every(s => s.status === 'approved');
    if (allApproved) {
      sub.status      = 'approved';
      sub.completedAt = new Date();
    } else {
      // Advance currentStep to the next pending one
      const nextPending = sub.facultyChain.findIndex((s, i) => i > stepIndex && s.status === 'pending');
      if (nextPending !== -1) sub.currentStep = nextPending;
    }

    await sub.save();
    return res.json({ message: 'Submission approved.', submission: sub });
  } catch (err) {
    console.error('Approve error:', err);
    return res.status(500).json({ message: 'Server error during approval.' });
  }
});

// PUT /api/submissions/faculty/:id/reject
router.put('/faculty/:id/reject', requireAuth, requireFaculty, async (req, res) => {
  try {
    const facultyId = req.session.user.username.toUpperCase();
    const { reason } = req.body;

    if (!reason || !reason.trim())
      return res.status(400).json({ message: 'Rejection reason is required.' });

    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Submission not found.' });

    const stepIndex = sub.facultyChain.findIndex(s => s.facultyId === facultyId);
    if (stepIndex === -1)
      return res.status(403).json({ message: 'You are not in the reviewer chain.' });

    if (sub.facultyChain[stepIndex].status !== 'pending')
      return res.status(400).json({ message: 'You have already acted on this submission.' });

    sub.facultyChain[stepIndex].status          = 'rejected';
    sub.facultyChain[stepIndex].rejectionReason = reason.trim();
    sub.status      = 'rejected';   // whole submission is rejected
    sub.completedAt = new Date();

    await sub.save();
    return res.json({ message: 'Submission rejected.', submission: sub });
  } catch (err) {
    console.error('Reject error:', err);
    return res.status(500).json({ message: 'Server error during rejection.' });
  }
});

module.exports = router;