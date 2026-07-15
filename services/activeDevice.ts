import { useEffect, useMemo, useState } from 'react';
import { useActiveGroup } from '@/services/activeGroup';
import {
  cloudDocIdForPiCode,
  listDevicesForFarm,
  type RegisteredDevice,
} from '@/services/devices';

export function usePrimaryCloudDevice() {
  const { active, loading: groupLoading } = useActiveGroup();
  const [device, setDevice] = useState<RegisteredDevice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    if (groupLoading) {
      setLoading(true);
      return () => {
        alive = false;
      };
    }

    if (!active?.id) {
      setDevice(null);
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    setLoading(true);
    listDevicesForFarm(active.id)
      .then((devices) => {
        if (!alive) return;
        setDevice(devices[0] ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setDevice(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [active?.id, groupLoading]);

  const cloudDeviceId = useMemo(
    () => (device ? cloudDocIdForPiCode(device.piCode) : null),
    [device],
  );

  return { activeFarm: active, device, cloudDeviceId, loading };
}