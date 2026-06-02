module.exports = (...roles) => {
  const flatRoles = roles.flat();
  return (req, res, next) => {
    if (!flatRoles.includes(req.user.role) && !flatRoles.includes(req.user.roleId)) {
      return res.json({ success: false, message: "Access Denied" });
    }
    next();
  };
};