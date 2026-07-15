/**
 * Active group context — which farm/group is the user currently viewing?
 *
 * A user may belong to multiple groups (e.g. owner of one, member of another).
 * The active group selector is persisted in AsyncStorage so it survives
 * reloads. Components subscribe via `useActiveGroup()`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { pushAlert } from './alerts';
import { subscribeAssignedTasks } from './farmTasks';
import { getCurrentAppUser, subscribeAuth } from './firebaseAuth';
import { listGroupsForUser, type Group, type GroupRole } from './groups';

const STORAGE_KEY = 'insectra.activeGroupId.v1';

export interface ActiveGroup extends Group {
  role: GroupRole;
}

interface ActiveGroupContextValue {
  loading: boolean;
  groups: ActiveGroup[];
  active: ActiveGroup | null;
  setActiveById: (groupId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ActiveGroupContextValue>({
  loading: true,
  groups: [],
  active: null,
  setActiveById: async () => {},
  refresh: async () => {},
});

export function ActiveGroupProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ActiveGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const u = getCurrentAppUser();
    if (!u) {
      setGroups([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    try {
      const list = await listGroupsForUser(u.uid);
      // eslint-disable-next-line no-console
      console.log('[activeGroup] refresh: uid=', u.uid, 'groups=', list.length, list);
      setGroups(list);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const validId =
        stored && list.find((g) => g.id === stored)
          ? stored
          : list[0]?.id ?? null;
      setActiveId(validId);
      if (validId && validId !== stored) {
        await AsyncStorage.setItem(STORAGE_KEY, validId);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[activeGroup] refresh failed:', err);
      setGroups([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-fetch when the auth state flips (sign-in/sign-out).
    const unsub = subscribeAuth(() => {
      refresh();
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    const user = getCurrentAppUser();
    if (!user || !activeId) return;

    let initialized = false;
    let openTaskIds = new Set<string>();
    const activeGroup = groups.find((group) => group.id === activeId);

    return subscribeAssignedTasks(activeId, user.uid, (tasks) => {
      const nextOpenTaskIds = new Set<string>();

      for (const task of tasks) {
        if (task.status !== 'open') continue;

        nextOpenTaskIds.add(task.id);
        if (initialized && !openTaskIds.has(task.id)) {
          pushAlert({
            severity: 'info',
            title: 'New task assigned',
            body: `${task.createdByName} assigned: ${task.title}${activeGroup?.name ? ` (${activeGroup.name})` : ''}`,
            route: '/operations',
            dedupeKey: `farm-task.${activeId}.${task.id}.open`,
          }).catch(() => undefined);
        }
      }

      openTaskIds = nextOpenTaskIds;
      initialized = true;
    });
  }, [activeId, groups]);

  const setActiveById = useCallback(async (groupId: string) => {
    setActiveId(groupId);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, groupId);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ActiveGroupContextValue>(() => {
    const active = groups.find((g) => g.id === activeId) ?? null;
    return { loading, groups, active, setActiveById, refresh };
  }, [loading, groups, activeId, setActiveById, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveGroup(): ActiveGroupContextValue {
  return useContext(Ctx);
}
