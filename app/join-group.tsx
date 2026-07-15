import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { useActiveGroup } from '@/services/activeGroup';
import { getCurrentAppUser, refreshVerificationStatus } from '@/services/firebaseAuth';
import { ensureUserProfile, joinGroupByCode } from '@/services/groups';

export default function JoinGroupScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { refresh, setActiveById } = useActiveGroup();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Inline banner so users on web (where react-native Alert.alert is a no-op)
  // still see success/error feedback.
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const handleJoin = async () => {
    setMessage(null);
    const user = getCurrentAppUser();
    if (!user || !user.emailVerified) {
      setMessage({ kind: 'error', text: 'You must verify your email before joining.' });
      return;
    }
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setMessage({ kind: 'error', text: 'Enter the 6-character invite code from the farm owner.' });
      return;
    }
    setBusy(true);
    try {
      try {
        await refreshVerificationStatus();
      } catch {
        /* non-fatal */
      }
      await ensureUserProfile({
        uid: user.uid,
        email: user.email,
        fullName: user.fullName || user.email,
      });
      const group = await joinGroupByCode({
        code: trimmed,
        uid: user.uid,
        email: user.email,
        fullName: user.fullName || user.email,
      });
      // Owners would otherwise get demoted to Member by the join flow's
      // setDoc — surface this clearly instead of silently overwriting.
      if (group.ownerUid === user.uid) {
        setMessage({ kind: 'success', text: `You already own “${group.name}”. Opening dashboard…` });
      } else {
        setMessage({ kind: 'success', text: `Joined “${group.name}” as Farm Member. Opening dashboard…` });
      }
      try {
        await refresh();
        await setActiveById(group.id);
      } catch {
        /* best-effort */
      }
      setTimeout(() => router.replace('/dashboard'), 300);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not join. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen contentStyle={styles.center}>
        <Card variant="elevated" style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons
              name="ticket-confirmation-outline"
              size={40}
              color={Colors.primaryDark}
            />
          </View>
          <Text style={styles.title}>Join a farm on InsecTra</Text>
          <Text style={styles.subtitle}>
            Enter the 6-character invite code from the farm owner.
          </Text>

          <View style={styles.field}>
            <MaterialCommunityIcons name="key-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="ABC234"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="Invite code"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={10}
              style={styles.input}
            />
          </View>

          {message && (
            <Card
              variant="outline"
              padded={false}
              style={[
                styles.banner,
                {
                  backgroundColor: message.kind === 'error' ? Colors.dangerBg : Colors.primaryTint,
                  borderColor: message.kind === 'error' ? Colors.danger + '55' : Colors.primary + '55',
                },
              ]}
            >
              <Badge
                label={message.kind === 'error' ? 'Error' : 'Success'}
                tone={message.kind === 'error' ? 'danger' : 'success'}
                icon={message.kind === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
              />
              <Text
                style={[
                  styles.bannerText,
                  { color: message.kind === 'error' ? Colors.danger : Colors.primaryDark },
                ]}
              >
                {message.text}
              </Text>
            </Card>
          )}

          <Button
            label="Join farm"
            icon="account-plus-outline"
            loading={busy}
            onPress={handleJoin}
            fullWidth
            style={styles.joinBtn}
          />

          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => router.back()}
            fullWidth
          />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },
    center: { flexGrow: 1, justifyContent: 'center' },
    card: { gap: Spacing.md },
    iconWrap: {
      alignSelf: 'center',
      width: 72,
      height: 72,
      borderRadius: Radius.full,
      backgroundColor: Colors.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    title: { ...Type.h1, color: Colors.primaryDark, textAlign: 'center' },
    subtitle: { ...Type.body, color: Colors.textSecondary, textAlign: 'center' },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: Colors.borderLight,
      backgroundColor: Colors.surface,
      marginTop: Spacing.xs,
    },
    input: {
      flex: 1,
      ...Type.h1,
      color: Colors.textPrimary,
      padding: 0,
      letterSpacing: 4,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.md,
    },
    bannerText: { flex: 1, ...Type.caption },
    joinBtn: { marginTop: Spacing.xs },
  });
