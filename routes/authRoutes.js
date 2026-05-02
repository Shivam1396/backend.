
const router = require('express').Router();
const User   = require('../models/User');

// ── POST /api/auth/signup ────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const {
      username, role, firstName, lastName, email, password,
      enrollYear, branch, rollNo, department, designation,
    } = req.body;

    if (!username || !role || !email || !password)
      return res.status(400).json({ message: 'Missing required fields.' });

    const exists = await User.findOne({ $or: [{ username }, { email }] });
    if (exists) {
      if (exists.username === username.toUpperCase())
        return res.status(409).json({ message: `Username ${username} is already registered.` });
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    const user = await User.create({
      username, role, firstName, lastName, email, password,
      enrollYear, branch, rollNo, department, designation,
    });

    return res.status(201).json({
      message: `Account created! Your ID: ${user.username}`,
      username: user.username,
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ message: 'Server error during signup.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ message: 'Username and password are required.' });

    const user = await User.findOne({ username: username.toUpperCase() });
    if (!user)
      return res.status(401).json({ message: 'Invalid username or password.' });

    const match = await user.matchPassword(password);
    if (!match)
      return res.status(401).json({ message: 'Invalid username or password.' });

    // Save lean data in session — no ObjectId, no BSON issues
    req.session.user = {
      id:             user._id.toString(),   // plain string
      username:       user.username,
      email:          user.email,
      role:           user.role,
      firstName:      user.firstName || '',
      lastName:       user.lastName  || '',
      department:     user.department || '',
      designation:    user.designation || '',
      graduationYear: user.graduationYear || '',
    };

    const redirect = user.role === 'faculty'
      ? '/public/teacher.html'
      : '/public/student.html';

    return res.json({ message: 'Login successful!', redirect });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error during login.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user)
    return res.status(401).json({ message: 'Not authenticated.' });
  return res.json(req.session.user);
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ message: 'Logout failed.' });
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logged out.' });
  });
});

module.exports = router;