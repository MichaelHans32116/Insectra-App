/**
 * /profile — User profile screen.
 *
 * Lets the signed-in user:
 *   • Edit their display name (mirrored to Firestore `users/{uid}.fullName`).
 *   • Change password (Firebase reauthenticate + updatePassword).
 *   • See and switch between farms they belong to.
 *   • Jump to "Join another community" (existing /join-group flow).
 *   • Sign out.
 *
 * Inline error/OK banners only — `Alert.alert` is silently dropped on web,
 * so we never rely on it for feedback.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, SectionHeader, EmptyState } from '@/components/ui';
import { useActiveGroup } from '@/services/activeGroup';
import { toast } from '@/services/eventBus';
import { useThemeStyles } from '@/services/theme';
import {
  getCurrentAppUser,
  signOutFirebase,
  subscribeAuth,
  updateUserFullName,
  changePassword,
  type AppUser,
} from '@/services/firebaseAuth';

type Banner = { kind: 'ok' | 'err'; text: string } | null;

export default function ProfileScreen() {
  const router = useRouter();
  const { groups, active, setActiveById } = useActiveGroup();
  const styles = useThemeStyles(createStyles);

  const [user, setUser] = useState<AppUser | null>(getCurrentAppUser());
  const [name, setName] = useState(user?.fullName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameBanner, setNameBanner] = useState<Banner>(null);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwBanner, setPwBanner] = useState<Banner>(null);

  useEffect(() => {
    setName(user?.fullName ?? '');
  }, [user]);

  useEffect(() => {
    const unsub = subscribeAuth((next) => {
      setUser(next);
    });
    return unsub;
  }, []);

  const handleSaveName = async () => {
    if (!name.trim()) {
      setNameBanner({ kind: 'err', text: 'Name cannot be empty.' });
      return;
    }
    setSavingName(true);
    setNameBanner(null);
    try {
      const next = await updateUserFullName(name);
      setUser(next);
      setNameBanner({ kind: 'ok', text: 'Saved.' });
      toast.ok('profile', 'Name updated', name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setNameBanner({ kind: 'err', text: msg });
      toast.err('profile', 'Name change failed', msg);
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePw = async () => {
    setPwBanner(null);
    if (!curPw || !newPw || !newPw2) {
      setPwBanner({ kind: 'err', text: 'All password fields are required.' });
      return;
    }
    if (newPw !== newPw2) {
      setPwBanner({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    if (newPw.length < 8) {
      setPwBanner({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(curPw, newPw);
      setCurPw('');
      setNewPw('');
      setNewPw2('');
      setPwBanner({ kind: 'ok', text: 'Password updated.' });
      toast.ok('profile', 'Password updated', 'Use the new password next time you sign in.');
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Could not change password.';
      const lower = raw.toLowerCase();
      let friendly = raw;
      if (lower.includes('wrong-password') || lower.includes('invalid-credential')) {
        friendly = 'Current password is incorrect.';
      } else if (lower.includes('weak-password')) {
        friendly = 'New password is too weak. Use at least 8 characters.';
      } else if (lower.includes('requires-recent-login')) {
        friendly = 'For security, please sign out and sign back in, then try again.';
      }
      setPwBanner({ kind: 'err', text: friendly });
      toast.err('profile', 'Password change failed', friendly);
    } finally {
      setSavingPw(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFirebase();
      router.replace('/login');
    } catch {
      /* ignore */
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.h1}>My profile</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Identity */}
        <Card style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {(user?.fullName || user?.email || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={styles.flex1}>
            <Text style={styles.identName} numberOfLines={1}>{user?.fullName || '(no name set)'}</Text>
            <Text style={styles.identEmail} numberOfLines={1}>{user?.email}</Text>
            <View style={styles.identBadge}>
              {user?.emailVerified ? (
                <Badge label="Email verified" tone="success" icon="check-circle" />
              ) : (
                <Badge label="Email not verified" tone="warning" icon="alert-circle-outline" />
              )}
            </View>
          </View>
        </Card>

        {/* ── Name ────────────────────────────────────────────── */}
        <View>
          <SectionHeader title="Display name" icon="account-edit-outline" />
          <Card variant="elevated" style={styles.section}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              placeholderTextColor={Colors.textTertiary}
            />
            {nameBanner && <Banner kind={nameBanner.kind} text={nameBanner.text} />}
            <Button
              label="Save name"
              icon="content-save-outline"
              loading={savingName}
              onPress={handleSaveName}
              fullWidth
            />
          </Card>
        </View>

        {/* ── Password ─────────────────────────────────────────── */}
        <View>
          <SectionHeader title="Change password" icon="lock-outline" />
          <Card variant="elevated" style={styles.section}>
            <Text style={styles.fieldLabel}>Current password</Text>
            <TextInput
              style={styles.input}
              value={curPw}
              onChangeText={setCurPw}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={Colors.textTertiary}
            />
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={Colors.textTertiary}
            />
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              value={newPw2}
              onChangeText={setNewPw2}
              secureTextEntry
              placeholder="Repeat new password"
              placeholderTextColor={Colors.textTertiary}
            />
            {pwBanner && <Banner kind={pwBanner.kind} text={pwBanner.text} />}
            <Button
              label="Update password"
              icon="lock-reset"
              loading={savingPw}
              onPress={handleChangePw}
              fullWidth
            />
          </Card>
        </View>

        {/* ── Communities / Farms ──────────────────────────────── */}
        <View>
          <SectionHeader title="My communities" icon="account-group-outline" />

          {/* Owner-only invite-code card — surface the join code right where
              owners look for it (their profile / community section). Members
              don't see this because they're joining, not inviting. */}
          {active?.role === 'Farm Owner' && active?.inviteCode && (
            <Card variant="accent" style={styles.inviteCard}>
              <View style={styles.inviteTitleRow}>
                <MaterialCommunityIcons name="ticket-confirmation-outline" size={18} color={Colors.primaryDark} />
                <Text style={styles.inviteTitle} numberOfLines={1}>Invite code for {active.name}</Text>
              </View>
              <Text style={styles.inviteHint}>Share this code so new members can join.</Text>
              <View style={styles.inviteCodeRow}>
                <Text style={styles.inviteCodeText} selectable>{active.inviteCode}</Text>
                <Button
                  label="Copy"
                  icon="content-copy"
                  size="sm"
                  onPress={async () => {
                    const code = active.inviteCode;
                    let copied = false;
                    try {
                      const webNavigator = (
                        globalThis as {
                          navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } };
                        }
                      ).navigator ?? null;
                      if (Platform.OS === 'web' && webNavigator?.clipboard?.writeText) {
                        await webNavigator.clipboard.writeText(code);
                        copied = true;
                      }
                    } catch { /* fallthrough */ }
                    setNameBanner({
                      kind: 'ok',
                      text: copied ? `Copied "${code}" to clipboard.` : `Code: ${code} — copy it manually.`,
                    });
                    setTimeout(() => setNameBanner(null), 2500);
                  }}
                />
              </View>
            </Card>
          )}

          <Card variant="elevated">
            {groups.length === 0 && (
              <EmptyState
                icon="account-group-outline"
                title="No farm yet"
                body="You haven't joined any farm yet."
              />
            )}
            {groups.map((g, idx) => {
              const isActive = active?.id === g.id;
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.commRow, idx > 0 && styles.commRowDivider]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${g.name}, ${g.role}`}
                  onPress={() => setActiveById(g.id)}
                >
                  <View style={styles.commIcon}>
                    <MaterialCommunityIcons
                      name={g.role === 'Farm Owner' ? 'crown' : 'account-group'}
                      size={20}
                      color={Colors.primaryDark}
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.commName} numberOfLines={1}>{g.name}</Text>
                    <Text style={styles.commRole}>{g.role}</Text>
                  </View>
                  {isActive && <Badge label="Active" tone="success" dot />}
                </TouchableOpacity>
              );
            })}
          </Card>

          <View style={styles.btnRow}>
            <Button
              label="Join farm"
              icon="account-multiple-plus"
              variant="secondary"
              onPress={() => router.push('/join-group')}
              style={styles.flex1}
            />
            <Button
              label="Create farm"
              icon="plus-circle-outline"
              variant="secondary"
              onPress={() => router.push('/create-group')}
              style={styles.flex1}
            />
          </View>
        </View>

        {/* Sign out */}
        <Button
          label="Sign out"
          icon="logout"
          variant="danger"
          onPress={handleSignOut}
          fullWidth
          style={styles.signOutBtn}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Banner(props: { kind: 'ok' | 'err'; text: string }) {
  const styles = useThemeStyles(createStyles);
  const isErr = props.kind === 'err';
  return (
    <View
      style={[
        styles.banner,
        isErr ? { backgroundColor: Colors.dangerBg } : { backgroundColor: Colors.primaryTint },
      ]}
    >
      <MaterialCommunityIcons
        name={isErr ? 'alert-circle-outline' : 'check-circle-outline'}
        size={16}
        color={isErr ? Colors.danger : Colors.primaryDark}
      />
      <Text
        style={[
          styles.bannerText,
          isErr ? { color: Colors.danger } : { color: Colors.primaryDark, fontWeight: '700' },
        ]}
      >
        {props.text}
      </Text>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  h1: { flex: 1, ...Type.h1, color: Colors.primaryDark },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: Colors.textOnPrimary, fontWeight: '800', fontSize: 22 },
  identName: { ...Type.title, color: Colors.textPrimary },
  identEmail: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  identBadge: { marginTop: Spacing.sm },

  section: { gap: Spacing.md },
  fieldLabel: { ...Type.label, color: Colors.textPrimary },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    ...Type.body,
    color: Colors.textPrimary,
    minHeight: 44,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  bannerText: { flex: 1, ...Type.caption },

  btnRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },

  commRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  commRowDivider: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  commIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commName: { ...Type.bodyStrong, color: Colors.textPrimary },
  commRole: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  signOutBtn: { marginTop: Spacing.md },

  inviteCard: { gap: Spacing.md, marginBottom: Spacing.md },
  inviteTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inviteTitle: { ...Type.label, color: Colors.primaryDark, flex: 1 },
  inviteHint: { ...Type.caption, color: Colors.textSecondary },
  inviteCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inviteCodeText: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});
