import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { getCurrentAppUser, refreshVerificationStatus, signOutFirebase } from '@/services/firebaseAuth';
import { useActiveGroup } from '@/services/activeGroup';
import { createGroup, ensureUserProfile, type Group } from '@/services/groups';

export default function CreateGroupScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { refresh, setActiveById } = useActiveGroup();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Group | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async () => {
    setErrorMsg(null);
    const user = getCurrentAppUser();
    if (!user) {
      setErrorMsg('You are not signed in. Please sign in again.');
      router.replace('/login');
      return;
    }
    if (!user.emailVerified) {
      setErrorMsg('You must verify your email before creating a farm. Redirecting…');
      Alert.alert('Verify required', 'You must verify your email before creating a farm.');
      router.replace('/verify-email');
      return;
    }
    if (!name.trim()) {
      setErrorMsg('Please enter a name for your farm.');
      return;
    }
    setBusy(true);
    try {
      // Force-refresh the ID token first so Firestore sees the latest
      // email_verified claim (otherwise rules deny with permission-denied).
      try {
        await refreshVerificationStatus();
      } catch {
        /* non-fatal */
      }
      // Ensure the user profile exists first.
      try {
        await ensureUserProfile({ uid: user.uid, email: user.email, fullName: user.fullName || user.email });
      } catch (profileErr) {
        // eslint-disable-next-line no-console
        console.warn('[create-group] ensureUserProfile failed (non-fatal):', profileErr);
      }
      const group = await createGroup({
        name: name.trim(),
        ownerUid: user.uid,
        ownerEmail: user.email,
        ownerFullName: user.fullName || user.email,
      });
      setCreated(group);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Try again.';
      // eslint-disable-next-line no-console
      console.error('[create-group] failed:', raw, e);
      const friendly = raw.includes('permission-denied') || raw.includes('insufficient permissions')
        ? 'Firestore rejected the write. Your auth token is stale (email_verified not yet propagated). Please tap "Sign out & sign back in" below, then try again.'
        : raw.includes('unavailable')
          ? 'Cannot reach Firestore. Check your internet connection and try again.'
          : raw.includes('not-found')
            ? 'Firestore database does not exist for project insectra-ccb58. Open Firebase Console → Firestore Database → Create database (Native mode, region: asia-southeast1).'
            : raw;
      setErrorMsg(friendly);
      Alert.alert('Could not create', friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleShareCode = async () => {
    if (!created) return;
    try {
      await Share.share({
        message:
          `You're invited to join "${created.name}" on InsecTra.\n\n` +
          `Open the InsecTra app, choose "I'm a Member", and enter this invite code:\n\n${created.inviteCode}`,
      });
    } catch {
      // ignore
    }
  };

  if (created) {
    return (
      <Screen contentStyle={styles.successContent}>
        <View style={styles.successIcon}>
          <MaterialCommunityIcons name="party-popper" size={44} color={Colors.primaryDark} />
        </View>
        <Text style={styles.successTitle}>Farm created!</Text>
        <Text style={styles.successSub}>{created.name}</Text>

        <Card variant="accent" style={styles.codeBox}>
          <Text style={styles.codeLabel}>INVITE CODE</Text>
          <Text style={styles.codeValue}>{created.inviteCode}</Text>
          <Text style={styles.codeHint}>Share this so your team can join as Members.</Text>
        </Card>

        <Button
          label="Share invite code"
          icon="share-variant"
          fullWidth
          onPress={handleShareCode}
        />

        <Button
          label="Continue to dashboard"
          iconRight="arrow-right"
          variant="secondary"
          fullWidth
          style={styles.continueBtn}
          onPress={async () => {
            try {
              await refresh();
              await setActiveById(created.id);
            } catch {
              /* ignore */
            }
            router.replace('/dashboard');
          }}
        />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen contentStyle={styles.formContent}>
        <Text style={styles.title}>Create your farm</Text>
        <Text style={styles.subtitle}>
          Give it a recognizable name. Your team joins with a 6-character invite code.
        </Text>

        {errorMsg && (
          <Card variant="outline" style={styles.errorBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
            <View style={styles.errorBody}>
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
              {(errorMsg.includes('stale') || errorMsg.includes('permission')) && (
                <Button
                  label="Sign out & sign back in"
                  variant="danger"
                  size="sm"
                  onPress={async () => {
                    await signOutFirebase();
                    router.replace('/login');
                  }}
                  style={styles.errorAction}
                />
              )}
            </View>
          </Card>
        )}

        <View style={styles.field}>
          <MaterialCommunityIcons name="barn" size={18} color={Colors.textSecondary} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Lola Aida's Bitter Gourd Farm"
            placeholderTextColor={Colors.textTertiary}
            style={styles.input}
          />
        </View>

        <Button
          label="Create farm"
          icon="check"
          loading={busy}
          fullWidth
          style={styles.primaryBtn}
          onPress={handleCreate}
        />

        <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  formContent: { gap: Spacing.md },
  successContent: { gap: Spacing.md, alignItems: 'stretch' },

  title: { ...Type.h1, color: Colors.primaryDark, marginTop: Spacing.lg },
  subtitle: { ...Type.body, color: Colors.textSecondary },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    minHeight: 48,
    marginTop: Spacing.xs,
  },
  input: { flex: 1, ...Type.body, color: Colors.textPrimary, padding: 0 },
  primaryBtn: { marginTop: Spacing.xs },

  // Success state
  successIcon: {
    alignSelf: 'center',
    width: 80,
    height: 80,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  successTitle: { ...Type.h1, color: Colors.primaryDark, textAlign: 'center' },
  successSub: { ...Type.body, color: Colors.textSecondary, textAlign: 'center' },
  codeBox: { alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  codeLabel: { ...Type.micro, color: Colors.textSecondary },
  codeValue: {
    ...Type.display,
    color: Colors.primaryDark,
    letterSpacing: 6,
  },
  codeHint: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },
  continueBtn: { marginTop: Spacing.xs },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.danger + '55',
  },
  errorBody: { flex: 1, gap: Spacing.sm },
  errorBannerText: { ...Type.caption, color: Colors.danger },
  errorAction: { alignSelf: 'flex-start' },
});
