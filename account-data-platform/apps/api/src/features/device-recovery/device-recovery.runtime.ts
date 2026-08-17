import { findDeviceByCode } from "../../repositories/device.repository";
import { createDatabaseDeviceRecoveryRepository } from "./device-recovery.repository";
import { createDeviceRecoveryRoutes } from "./device-recovery.routes";
import { createDeviceRecoveryService } from "./device-recovery.service";

const repository = createDatabaseDeviceRecoveryRepository(async (deviceCode) => {
  const device = await findDeviceByCode(deviceCode);
  return device ? { id: device.id, deviceCode: device.deviceCode } : null;
});
export const deviceRecoveryService = createDeviceRecoveryService({ repository });

export const deviceRecoveryRoutes = createDeviceRecoveryRoutes({ service: deviceRecoveryService });
