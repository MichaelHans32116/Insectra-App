import React, { useState } from 'react';
import {
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
import { registerWithFirebase } from '@/services/firebaseAuth';
import { ensureUserProfile } from '@/services/groups';

export default function RegisterScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRegister = async () => {
    setErrorMsg(null);
    if (!fullName.trim() || !email.trim() || !password) {
      setErrorMsg('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match. Please re-enter the same password in both fields.");
      return;
    }
    setBusy(true);
    try {
      const user = await registerWithFirebase({
        email: email.trim(),
        fullName: fullName.trim(),
        password,
      });
      // Create matching user profile doc in Firestore (best-effort).
      try {
        await ensureUserProfile({
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
        });
      } catch {
        // Profile creation may fail if rules require email_verified=true.
        // We'll retry from the verify-email screen after verification completes.
      }
      if (user.verificationEmailError) {
        Alert.alert(
          'Account created — but verification email failed',
          `Account ${user.email} was created, but the verification email could not be sent: ${user.verificationEmailError}\n\nYou can press "Resend verification" on the next screen.`,
        );
      }
      router.replace('/verify-email');
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Registration failed.';
      // Friendly message for the most common Firebase error codes.
      const friendly =
        raw.includes('email-already-in-use')
          ? 'That email is already registered. Try signing in instead.'
          : raw.includes('weak-password')
            ? 'Password is too weak. Use at least 8 characters.'
            : raw.includes('invalid-email')
              ? 'That email address looks invalid. Please double-check it.'
              : raw.includes('network-request-failed')
                ? 'Network error. Check your internet connection and try again.'
                : raw.includes('configuration-not-found')
                  ? 'Email/Password sign-in is NOT enabled in this Firebase project.\n\nFix: open Firebase Console → Authentication → Sign-in method → enable "Email/Password" provider, then try again.\n\nProject: insectra-ccb58'
                  : raw.includes('operation-not-allowed')
                    ? 'Email/Password sign-in is disabled in this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method.'
                    : raw;
      // eslint-disable-next-line no-console
      console.error('[register] failed:', raw);
      setErrorMsg(friendly);
      Alert.alert('Registration failed', friendly);
    } finally {
      setBusy(false);
    }
  };

  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen contentStyle={styles.content}>
        <View style={styles.logoWrap}>
          <Image
            source={require('@/assets/insectra-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.brand}>Create your account</Text>
          <Text style={styles.tagline}>We'll email you a verification link.</Text>
        </View>

        <Card variant="elevated" style={styles.card}>
          {errorMsg && (
            <View style={styles.errorBanner}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          )}
          <View style={styles.field}>
            <MaterialCommunityIcons name="account-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full name"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="words"
              style={styles.input}
            />
          </View>

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
              placeholder="Password (min. 8 characters)"
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

          <View style={[styles.field, confirmMismatch && styles.fieldError]}>
            <MaterialCommunityIcons name="lock-check-outline" size={18} color={Colors.textSecondary} />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry={!showConfirm}
              style={styles.input}
            />
            <TouchableOpacity
              onPress={() => setShowConfirm((p) => !p)}
              hitSlop={13}
              accessibilityRole="button"
              accessibilityLabel={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
            >
              <MaterialCommunityIcons
                name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          {confirmMismatch && (
            <Text style={styles.errorHint}>Passwords don't match.</Text>
          )}

          <Button
            label="Register & send verification"
            icon="email-fast-outline"
            loading={busy}
            onPress={handleRegister}
            fullWidth
            style={styles.submitBtn}
          />

          <TouchableOpacity onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={styles.linkText}>I already have an account — Sign in</Text>
          </TouchableOpacity>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },
    content: { justifyContent: 'center', flexGrow: 1, gap: Spacing.lg },

    logoWrap: { alignItems: 'center', gap: Spacing.sm },
    logo: { width: 80, height: 80 },
    brand: { ...Type.h1, color: Colors.primaryDark },
    tagline: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },

    card: { gap: Spacing.md },
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
    fieldError: { borderColor: Colors.danger },
    errorHint: { ...Type.caption, color: Colors.danger, marginTop: -Spacing.xs, marginLeft: Spacing.xs },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radius.md,
      backgroundColor: Colors.dangerBg,
      borderWidth: 1,
      borderColor: Colors.danger + '55',
    },
    errorBannerText: { flex: 1, ...Type.caption, color: Colors.danger, lineHeight: 17 },
    submitBtn: { marginTop: Spacing.xs },
    linkText: {
      ...Type.caption,
      color: Colors.primaryDark,
      textAlign: 'center',
      textDecorationLine: 'underline',
      marginTop: Spacing.xs,
    },
  });
