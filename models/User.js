const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, trim: true, uppercase: true },
  role:        { type: String, enum: ['student','faculty'], required: true },
  firstName:   { type: String, trim: true },
  lastName:    { type: String, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:    { type: String, required: true },

  // Student-specific
  enrollYear:  String,
  branch:      String,
  rollNo:      String,
  graduationYear: String,

  // Faculty-specific
  department:  String,
  designation: String,
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);