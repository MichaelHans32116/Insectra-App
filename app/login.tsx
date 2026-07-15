import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { Screen, Card, Button } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import {
  signInWithFirebase,
  EmailNotVerifiedError,
  sendPasswordReset,
} from '@/services/firebaseAuth';
import { listGroupsForUser } from '@/services/groups';
import { loadSession } from '@/services/auth';

export default function LoginScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (!session) {
        setChecking(false);
        return;
      }
      if (!session.emailVerified) {
        router.replace('/verify-email');
        return;
      }
      try {
        const groups = await listGroupsForUser(session.uid);
        router.replace(groups.length > 0 ? '/dashboard' : '/register-role');
      } catch {
        router.replace('/register-role');
      }
    })();
  }, [router]);

  const handleLogin = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim() || !password) {
      setErrorMsg('Enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      const user = await signInWithFirebase({ email, password });
      // Decide where to send them next.
      try {
        const groups = await listGroupsForUser(user.uid);
        router.replace(groups.length > 0 ? '/dashboard' : '/register-role');
      } catch {
        router.replace('/register-role');
      }
    } catch (e) {
      if (e instanceof EmailNotVerifiedError) {
        router.replace('/verify-email');
        return;
      }
      const raw = e instanceof Error ? e.message : 'Try again.';
      // eslint-disable-next-line no-console
      console.error('[login] failed:', raw);
      const friendly =
        raw.includes('invalid-credential') || raw.includes('wrong-password') || raw.includes('INVALID_LOGIN_CREDENTIALS')
          ? 'Wrong email or password. If you forgot your password, tap "Forgot password?" below.'
          : raw.includes('user-not-found')
            ? 'No account exists for this email. Create one first.'
            : raw.includes('too-many-requests')
              ? 'Too many failed attempts. Wait a minute or reset your password.'
              : raw.includes('user-disabled')
                ? 'This account has been disabled. Contact support.'
                : raw.includes('network-request-failed')
                  ? 'Network error. Check your internet connection.'
                  : raw;
      setErrorMsg(friendly);
      Alert.alert('Sign in failed', friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setErrorMsg('Type your email address above first, then tap "Forgot password?".');
      return;
    }
    setResetting(true);
    try {
      await sendPasswordReset(email);
      setInfoMsg(`Password-reset link sent to ${email.trim()}. Check your inbox AND Spam folder. Sender: noreply@insectra-ccb58.firebaseapp.com`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Could not send reset email.';
      // eslint-disable-next-line no-console
      console.error('[login] forgot password failed:', raw);
      const friendly =
        raw.includes('user-not-found')
          ? 'No account exists for this email.'
          : raw.includes('invalid-email')
            ? 'That email looks invalid.'
            : raw;
      setErrorMsg(friendly);
    } finally {
      setResetting(false);
    }
  };

  if (checking) {
    return (
      <Screen scroll={false} contentStyle={styles.checkingContent}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen contentStyle={styles.centerContent} gap={Spacing.lg}>
        <View style={styles.logoWrap}>
          <Image
            source={require('@/assets/insectra-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.brand}>InsecTra</Text>
          <Text style={styles.tagline}>IoT Pest Monitoring for Bitter Gourd Farms</Text>
        </View>

        <Card variant="elevated" style={styles.cardGap}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardSubtitle}>Use your verified Firebase account.</Text>

          {errorMsg && (
            <View style={styles.errorBanner}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          )}
          {infoMsg && (
            <View style={styles.infoBanner}>
              <MaterialCommunityIcons name="information-outline" size={18} color={Colors.primaryDark} />
              <Text style={styles.infoBannerText}>{infoMsg}</Text>
            </View>
          )}

          <View style={styles.field}>
            <MaterialCommunityIcons name="email-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <MaterialCommunityIcons name="lock-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry={!showPassword}
              style={styles.input}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((p) => !p)}
              hitSlop={13}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <MaterialCommunityIcons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <Button
            label="Sign in"
            icon="login"
            variant="primary"
            fullWidth
            loading={busy}
            onPress={handleLogin}
            style={styles.signInGap}
          />

          <TouchableOpacity onPress={handleForgotPassword} hitSlop={8} disabled={resetting}>
            <Text style={styles.forgotLink}>
              {resetting ? 'Sending reset email…' : 'Forgot password?'}
            </Text>
          </TouchableOpacity>
        </Card>

        <Card variant="accent" style={styles.cardGap}>
          <Text style={styles.registerTitle}>No account yet?</Text>
          <Text style={styles.registerHint}>
            Register as an Insectra Owner (with a Pi device) or as a Member joining a farm.
          </Text>
          <Button
            label="Create an account"
            icon="account-plus-outline"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/register')}
            style={styles.signInGap}
          />
        </Card>

        <Text style={styles.footer}>
          Real Firebase Auth · Email verification required · Project: insectra-ccb58
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  centerContent: { flexGrow: 1, justifyContent: 'center' },
  checkingContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  logoWrap: { alignItems: 'center', gap: Spacing.sm },
  logo: { width: 110, height: 110 },
  brand: { ...Type.h1, color: Colors.primaryDark, letterSpacing: 0.5 },
  tagline: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },

  cardGap: { gap: Spacing.md },
  cardTitle: { ...Type.h2, color: Colors.textPrimary },
  cardSubtitle: { ...Type.caption, color: Colors.textSecondary, marginTop: -Spacing.sm },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt,
    minHeight: 44,
  },
  input: { flex: 1, ...Type.body, color: Colors.textPrimary, padding: 0 },

  signInGap: { marginTop: Spacing.xs },
  forgotLink: {
    ...Type.caption,
    color: Colors.primaryDark,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: Spacing.xs,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '55',
  },
  errorBannerText: { flex: 1, ...Type.caption, color: Colors.danger, lineHeight: 17 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  infoBannerText: { flex: 1, ...Type.caption, color: Colors.primaryDark, lineHeight: 17 },

  registerTitle: { ...Type.bodyStrong, color: Colors.primaryDark },
  registerHint: { ...Type.caption, color: Colors.textSecondary, lineHeight: 17 },

  footer: {
    ...Type.micro,
    fontWeight: '500',
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
});
