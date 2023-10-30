import { Tenant } from "../services/tenants.service";
import { User } from "../services/users.service";

export const getFolderName = (user?: User, tenant?: Tenant) => {
  const tenantPath = tenant?.id || 'private';
  const userPath = user?.id || 'user';

  return `uploads/forms/${tenantPath}/${userPath}`;
};
