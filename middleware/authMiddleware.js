function requireAuth(req, res, next) {
  if (!req.session.user) {
    // If it's an API call, send JSON; if page, redirect
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ message: "Please login first" });
    }
    return res.redirect("/login.html");
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ message: "Access denied" });
      }
      // Redirect to correct dashboard based on role
      if (req.session.user?.role === "faculty") return res.redirect("/teacher.html");
      if (req.session.user?.role === "student") return res.redirect("/student.html");
      return res.redirect("/login.html");
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };