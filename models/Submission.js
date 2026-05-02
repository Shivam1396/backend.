const mongoose = require('mongoose');

const chainStepSchema = new mongoose.Schema({
  facultyId:  { type: String, required: true, uppercase: true },
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  signedAt:   Date,
  rejectionReason: String,
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  // Submitter
  studentId:   { type: String, required: true, uppercase: true },
  studentName: { type: String },

  // Document meta
  title:       { type: String, required: true },
  type:        { type: String },
  department:  { type: String },
  semester:    { type: String },
  notes:       { type: String },
  urgent:      { type: Boolean, default: false },

  // File
  fileName:    String,
  filePath:    String,  // URL path like /uploads/filename.pdf

  // Approval chain: array of { facultyId, status, signedAt, rejectionReason }
  facultyChain: [chainStepSchema],

  // Overall status — derived from chain
  status:       { type: String, enum: ['pending','approved','rejected'], default: 'pending' },

  // Who currently needs to act (index into facultyChain)
  currentStep:  { type: Number, default: 0 },

  submittedAt:  { type: Date, default: Date.now },
  completedAt:  Date,
}, { timestamps: true });

module.exports = mongoose.model('Submission', submissionSchema);