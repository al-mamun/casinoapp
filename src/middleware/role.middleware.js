module.exports = (...roles) => {
  const flatRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required", errorCode: "UNAUTHORIZED" });
    }
    if (!flatRoles.includes(req.user.role) && !flatRoles.includes(req.user.roleId)) {
      return res.status(403).json({ success: false, message: "Access Denied", errorCode: "PERMISSION_DENIED" });
    }
    next();
  };
};