const ROLES = {
  OWNER: 1, MOTHER: 2, WHITE_LABEL: 3, SUPER_ADMIN: 4, ADMIN: 5,
  B2C_SUB_ADMIN: 6, SENIOR_AFFILIATE: 7, AFFILIATE: 8,
  B2B_SUB_ADMIN: 9, SUPER_AGENT: 10, MASTER_AGENT: 11, PLAYER: 12,
};

function canCreate(creator, target) {
  if (creator === ROLES.OWNER) return target <= ROLES.MOTHER;
  if (creator === ROLES.MOTHER) return target <= ROLES.WHITE_LABEL;
  if (creator === ROLES.WHITE_LABEL) return target <= ROLES.ADMIN;
  if (creator === ROLES.B2B_SUB_ADMIN) return target <= ROLES.MASTER_AGENT;
  if (creator === ROLES.MASTER_AGENT) return target === ROLES.PLAYER;
  return false; 
}
module.exports = { ROLES, canCreate };