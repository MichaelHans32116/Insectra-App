import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AlertsBell from '@/components/AlertsBell';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, SectionHeader, StatTile } from '@/components/ui';
import { usePrimaryCloudDevice } from '@/services/activeDevice';
import { computeBatteryHealth, computeTrapCapacity } from '@/services/deviceHealth';
import {
  createFarmTask,
  subscribeFarmTasks,
  updateFarmTaskStatus,
  type FarmTask,
} from '@/services/farmTasks';
import { listenDeviceState, type DeviceState } from '@/services/iotRealtime';
import { signOut } from '@/services/auth';
import { useActiveGroup } from '@/services/activeGroup';
import { joinGroupByCode, listMembers, type GroupMember } from '@/services/groups';
import { getCurrentAppUser, refreshVerificationStatus } from '@/services/firebaseAuth';
import { useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';

const ROLE_RULES: Array<{ role: 'Farm Owner' | 'Farm Member'; icon: keyof typeof MaterialCommunityIcons.glyphMap; rules: string[] }> = [
  { role: 'Farm Owner', icon: 'shield-account-outline', rules: ['Manage team', 'Assign tasks', 'Reset trap count', 'Share invite code'] },
  { role: 'Farm Member', icon: 'account-hard-hat-outline', rules: ['View traps', 'Finish tasks', 'Log visits', 'Capture evidence'] },
];

function percentText(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function statTone(level: string): 'default' | 'danger' | 'warning' | 'accent' | 'success' {
  switch (level) {
    case 'critical': return 'danger';
    case 'warning': return 'warning';
    case 'watch': return 'accent';
    case 'unknown': return 'default';
    default: return 'success';
  }
}

function formatTaskTime(value: string): string {
  if (!value) return 'just now';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'just now';
  return new Date(timestamp).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OperationsScreen() {
  const router = useRouter();
  const { active, refresh } = useActiveGroup();
  const { device: targetDevice, cloudDeviceId: targetCloudDeviceId } = usePrimaryCloudDevice();
  const styles = useThemeStyles(createStyles);
  const text_ = useLocalText();
  const currentUser = getCurrentAppUser();
  const isOwner = active?.role === 'Farm Owner';
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [tasks, setTasks] = useState<FarmTask[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [selectedAssigneeUid, setSelectedAssigneeUid] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinMsg, setJoinMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!targetCloudDeviceId) {
      setDeviceState(null);
      return;
    }
    const unsubscribe = listenDeviceState(targetCloudDeviceId, setDeviceState);
    return unsubscribe;
  }, [targetCloudDeviceId]);

  useEffect(() => {
    if (!active?.id) { setMembers([]); return; }
    let alive = true;
    listMembers(active.id)
      .then((rows) => { if (alive) setMembers(rows); })
      .catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, [active?.id]);

  useEffect(() => {
    if (!active?.id) {
      setTasks([]);
      return;
    }
    return subscribeFarmTasks(active.id, setTasks);
  }, [active?.id]);

  const battery = useMemo(() => computeBatteryHealth(deviceState), [deviceState]);
  const trap = useMemo(() => computeTrapCapacity(deviceState), [deviceState]);
  const farmName = active?.name ?? deviceState?.farmName ?? 'No farm selected';
  const farmZone = deviceState?.farmZone ?? '';
  const currentDeviceLabel = targetDevice ? `${targetDevice.name} (${targetDevice.piCode})` : null;
  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );
  const selectedAssignee = useMemo(
    () => activeMembers.find((member) => member.uid === selectedAssigneeUid) ?? null,
    [activeMembers, selectedAssigneeUid],
  );
  const visibleTasks = useMemo(
    () => (isOwner ? tasks : tasks.filter((task) => task.assigneeUid === currentUser?.uid)),
    [currentUser?.uid, isOwner, tasks],
  );

  useEffect(() => {
    if (activeMembers.length === 0) {
      setSelectedAssigneeUid('');
      return;
    }
    if (activeMembers.some((member) => member.uid === selectedAssigneeUid)) {
      return;
    }
    const preferredMember = activeMembers.find((member) => member.role !== 'Farm Owner') ?? activeMembers[0];
    setSelectedAssigneeUid(preferredMember.uid);
  }, [activeMembers, selectedAssigneeUid]);

  const handleJoin = async () => {
    setJoinMsg(null);
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinMsg({ kind: 'error', text: 'Enter the 6-character invite code.' });
      return;
    }
    const me = getCurrentAppUser();
    if (!me) {
      setJoinMsg({ kind: 'error', text: 'Please sign in again to join a farm.' });
      return;
    }
    if (!me.emailVerified) {
      setJoinMsg({ kind: 'error', text: 'Verify your email before joining.' });
      return;
    }
    setJoining(true);
    try {
      try {
        await refreshVerificationStatus();
      } catch {
        /* non-fatal */
      }
      const group = await joinGroupByCode({
        code,
        uid: me.uid,
        email: me.email ?? '',
        fullName: me.fullName || me.email || 'Member',
      });
      await refresh();
      setJoinCode('');
      if (group.ownerUid === me.uid) {
        setJoinMsg({ kind: 'success', text: `You already own “${group.name}”.` });
      } else {
        setJoinMsg({ kind: 'success', text: `Joined “${group.name}”.` });
      }
    } catch (e) {
      setJoinMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Could not join. Try again.' });
    } finally {
      setJoining(false);
    }
  };

  const handleCreateTask = async () => {
    if (!isOwner || !active?.id || !currentUser) {
      Alert.alert('Owner only', 'Only the Farm Owner can assign tasks.');
      return;
    }
    if (!taskTitle.trim()) {
      Alert.alert('Task title required', 'Write the task before assigning it.');
      return;
    }
    if (!selectedAssignee) {
      Alert.alert('Pick a member', 'Choose which member should receive this task.');
      return;
    }
    setCreatingTask(true);
    try {
      await createFarmTask({
        farmId: active.id,
        title: taskTitle,
        details: taskDetails,
        assigneeUid: selectedAssignee.uid,
        assigneeName: selectedAssignee.fullName || selectedAssignee.email,
        assigneeEmail: selectedAssignee.email,
        createdByUid: currentUser.uid,
        createdByName: currentUser.fullName || currentUser.email,
      });
      setTaskTitle('');
      setTaskDetails('');
      Alert.alert('Task assigned', `Assigned to ${selectedAssignee.fullName || selectedAssignee.email}.`);
    } catch (e) {
      Alert.alert('Could not assign task', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setCreatingTask(false);
    }
  };

  const handleToggleTask = async (task: FarmTask) => {
    if (!active?.id || !currentUser) return;
    if (!isOwner && task.assigneeUid !== currentUser.uid) {
      Alert.alert('Members are view-only', 'Only the assignee or farm owner can update this task.');
      return;
    }
    setSavingTaskId(task.id);
    try {
      await updateFarmTaskStatus(active.id, task.id, task.status === 'open' ? 'done' : 'open');
    } catch (e) {
      Alert.alert('Could not update task', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSavingTaskId(null);
    }
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <Text style={styles.title}>{text_('Farm operations', 'Operasyon ng sakahan')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{farmZone ? `${farmName} — ${farmZone}` : farmName}</Text>
          <Text style={styles.deviceHint} numberOfLines={1}>
            {currentDeviceLabel ? `${text_('Device', 'Device')}: ${currentDeviceLabel}` : text_('No trap linked yet', 'Walang naka-link na trap')}
          </Text>
        </View>
        <AlertsBell tint={Colors.primaryDark} />
      </View>

      {/* Health */}
      <View style={styles.statGrid}>
        <View style={styles.flex1}>
          <StatTile label={text_('Battery', 'Baterya')} value={percentText(battery.percent)} icon="battery-heart-outline" tone={statTone(battery.level)} hint={battery.detail} />
        </View>
        <View style={styles.flex1}>
          <StatTile label={text_('Trap fill', 'Laman ng trap')} value={`${trap.percent}%`} icon="archive-alert-outline" tone={statTone(trap.level)} hint={`${trap.countSinceService}/${trap.capacity}`} />
        </View>
      </View>

      {/* Join */}
      <Card style={styles.gap12}>
        <SectionHeader title={text_('Join farm team', 'Sumali sa team')} icon="account-plus-outline" />
        <View style={styles.joinRow}>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            placeholder={text_('Invite code', 'Invite code')}
            placeholderTextColor={Colors.textTertiary}
            style={styles.joinInput}
            maxLength={12}
          />
          <Button label={joining ? '…' : text_('Join', 'Sali')} icon="login" onPress={handleJoin} loading={joining} />
        </View>
        <Text style={styles.hint}>{text_('Owners: your invite code is on Profile › My Communities.', 'May-ari: nasa Profile › My Communities ang invite code mo.')}</Text>
        {joinMsg && (
          <View style={[styles.banner, joinMsg.kind === 'error' ? styles.bannerError : styles.bannerSuccess]}>
            <MaterialCommunityIcons
              name={joinMsg.kind === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
              size={14}
              color={joinMsg.kind === 'error' ? Colors.danger : Colors.primaryDark}
            />
            <Text style={[styles.bannerText, { color: joinMsg.kind === 'error' ? Colors.danger : Colors.primaryDark }]}>
              {joinMsg.text}
            </Text>
          </View>
        )}
      </Card>

      {/* Team roles */}
      <Card style={styles.gap12}>
        <SectionHeader title={text_('Team roles', 'Mga role')} icon="shield-key-outline" />
        <View style={styles.roleGrid}>
          {ROLE_RULES.map((item) => (
            <View key={item.role} style={styles.roleCard}>
              <View style={styles.roleHeader}>
                <MaterialCommunityIcons name={item.icon} size={18} color={Colors.primary} />
                <Text style={styles.roleTitle}>{item.role}</Text>
              </View>
              {item.rules.map((rule) => (
                <View key={rule} style={styles.ruleRow}>
                  <View style={styles.ruleDot} />
                  <Text style={styles.ruleText}>{rule}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </Card>

      {/* Members */}
      <Card style={styles.gap12}>
        <SectionHeader title={text_('Members', 'Mga miyembro')} icon="account-multiple-check-outline" />
        {members.length === 0 ? (
          <Text style={styles.hint}>{text_('No members yet — share your invite code.', 'Wala pang miyembro — ibahagi ang invite code.')}</Text>
        ) : (
          members.map((member) => (
            <View key={member.uid} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(member.fullName || member.email || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.flex1}>
                <Text style={styles.memberName} numberOfLines={1}>{member.fullName || member.email}</Text>
                <Text style={styles.memberRole}>{member.role}</Text>
              </View>
              <Badge label={member.status === 'active' ? text_('Active', 'Aktibo') : member.status.charAt(0).toUpperCase() + member.status.slice(1)} tone={member.status === 'active' ? 'success' : 'neutral'} />
            </View>
          ))
        )}
      </Card>

      {/* Assign task (owner) */}
      {isOwner && (
        <Card style={styles.gap12}>
          <SectionHeader title={text_('Assign task', 'Mag-assign')} icon="clipboard-plus-outline" />
          <TextInput
            value={taskTitle}
            onChangeText={setTaskTitle}
            placeholder={text_('Task title', 'Pamagat ng gawain')}
            placeholderTextColor={Colors.textTertiary}
            style={styles.taskInput}
          />
          <TextInput
            value={taskDetails}
            onChangeText={setTaskDetails}
            placeholder={text_('Instructions or notes', 'Paalala o tagubilin')}
            placeholderTextColor={Colors.textTertiary}
            style={[styles.taskInput, styles.taskDetailsInput]}
            multiline
            textAlignVertical="top"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assigneeRow}>
            {activeMembers.map((member) => (
              <TouchableOpacity
                key={member.uid}
                style={[styles.assigneeChip, selectedAssigneeUid === member.uid && styles.assigneeChipActive]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedAssigneeUid === member.uid }}
                hitSlop={{ top: 8, bottom: 8 }}
                onPress={() => setSelectedAssigneeUid(member.uid)}
              >
                <Text style={[styles.assigneeChipText, selectedAssigneeUid === member.uid && styles.assigneeChipTextActive]}>
                  {member.fullName || member.email}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Button
            label={creatingTask
              ? text_('Assigning…', 'Ina-assign…')
              : `${text_('Assign to', 'I-assign kay')} ${selectedAssignee?.fullName || selectedAssignee?.email || text_('member', 'miyembro')}`}
            icon="send-check-outline"
            onPress={handleCreateTask}
            loading={creatingTask}
            disabled={!selectedAssignee || !taskTitle.trim()}
            fullWidth
          />
        </Card>
      )}

      {/* Task board */}
      <Card style={styles.gap12}>
        <SectionHeader title={isOwner ? text_('Task board', 'Task board') : text_('My tasks', 'Mga gawain ko')} icon="format-list-checks" />
        {visibleTasks.length === 0 ? (
          <Text style={styles.hint}>
            {isOwner
              ? text_('No tasks yet — assign the first field visit above.', 'Wala pang gawain — mag-assign sa itaas.')
              : text_('No tasks assigned yet.', 'Wala pang nakatalagang gawain.')}
          </Text>
        ) : (
          visibleTasks.map((task) => (
            <View key={task.id} style={[styles.taskCard, task.status === 'done' && styles.taskCardDone]}>
              <View style={styles.taskTopRow}>
                <Badge label={task.status === 'done' ? text_('Done', 'Tapos') : text_('Open', 'Bukas')} tone={task.status === 'done' ? 'success' : 'warning'} />
                {isOwner && <Text style={styles.taskAssignee} numberOfLines={1}>{task.assigneeName}</Text>}
              </View>
              <Text style={styles.taskTitle}>{task.title}</Text>
              {task.details ? <Text style={styles.taskDetails}>{task.details}</Text> : null}
              <Text style={styles.taskMeta} numberOfLines={1}>
                {isOwner ? `${text_('To', 'Kay')} ${task.assigneeName}` : `${text_('From', 'Mula')} ${task.createdByName}`}
                {' · '}
                {formatTaskTime(task.updatedAt || task.createdAt)}
              </Text>
              {(isOwner || task.assigneeUid === currentUser?.uid) && (
                <Button
                  label={savingTaskId === task.id
                    ? text_('Saving…', 'Sini-save…')
                    : task.status === 'done' ? text_('Reopen', 'Buksan ulit') : text_('Mark done', 'Markahang tapos')}
                  icon={task.status === 'done' ? 'backup-restore' : 'check-circle-outline'}
                  variant={task.status === 'done' ? 'secondary' : 'primary'}
                  size="sm"
                  loading={savingTaskId === task.id}
                  onPress={() => handleToggleTask(task)}
                  style={styles.taskAction}
                />
              )}
            </View>
          ))
        )}
      </Card>

      <Button
        label={text_('Sign out', 'Mag-sign out')}
        icon="logout"
        variant="secondary"
        onPress={async () => {
          await signOut();
          router.replace('/login');
        }}
        style={styles.signOut}
      />
    </Screen>
  );
}

const createStyles = () => StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  gap12: { gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  title: { ...Type.h1, color: Colors.textPrimary },
  subtitle: { ...Type.body, color: Colors.textSecondary, marginTop: 2 },
  deviceHint: { ...Type.caption, color: Colors.textTertiary, marginTop: 2 },

  statGrid: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'stretch' },

  hint: { ...Type.caption, color: Colors.textSecondary },

  joinRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  joinInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  bannerError: { backgroundColor: Colors.dangerBg, borderColor: Colors.danger + '55' },
  bannerSuccess: { backgroundColor: Colors.primaryTint, borderColor: Colors.primary + '55' },
  bannerText: { flex: 1, ...Type.caption, fontWeight: '600' },

  roleGrid: { gap: Spacing.sm },
  roleCard: { borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.primaryFaint, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  roleHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  roleTitle: { ...Type.label, color: Colors.textPrimary },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ruleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primaryLight },
  ruleText: { flex: 1, ...Type.caption, color: Colors.textSecondary },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: Spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.primaryDark, fontWeight: '800', fontSize: 14 },
  memberName: { ...Type.bodyStrong, color: Colors.textPrimary },
  memberRole: { ...Type.caption, color: Colors.textSecondary },

  taskInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
  },
  taskDetailsInput: { minHeight: 86 },
  assigneeRow: { gap: Spacing.sm, paddingRight: 4 },
  assigneeChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  assigneeChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryTint },
  assigneeChipText: { ...Type.caption, fontWeight: '700', color: Colors.textSecondary },
  assigneeChipTextActive: { color: Colors.primaryDark },

  taskCard: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  taskCardDone: { backgroundColor: Colors.primaryFaint, borderColor: Colors.primaryPale },
  taskTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  taskAssignee: { ...Type.caption, color: Colors.textSecondary, flexShrink: 1 },
  taskTitle: { ...Type.bodyStrong, color: Colors.textPrimary },
  taskDetails: { ...Type.caption, color: Colors.textSecondary },
  taskMeta: { ...Type.caption, color: Colors.textTertiary },
  taskAction: { alignSelf: 'flex-start' },

  signOut: { marginTop: Spacing.xs },
});
