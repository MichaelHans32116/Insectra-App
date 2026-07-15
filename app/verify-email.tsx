import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import {
  getCurrentAppUser,
  refreshVerificationStatus,
  resendVerificationEmail,
  signOutFirebase,
} from '@/services/firebaseAuth';
import { ensureUserProfile, listGroupsForUser } from '@/services/groups';

const RESEND_COOLDOWN_SECONDS = 60;
const AUTO_POLL_INTERVAL_MS = 5000;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [autoChecking, setAutoChecking] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);
  const navigatedRef = useRef(false);

  // Initial auth check + grab email.
  useEffect(() => {
    const u = getCurrentAppUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    if (u.emailVerified) {
      router.replace('/register-role');
      return;
    }
    setEmail(u.email);
  }, [router]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const proceedAfterVerified = useCallback(async () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    const u = getCurrentAppUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    try {
      await ensureUserProfile({
        uid: u.uid,
        email: u.email,
        fullName: u.fullName || u.email,
      });
      const groups = await listGroupsForUser(u.uid);
      router.replace(groups.length > 0 ? '/dashboard' : '/register-role');
    } catch {
      router.replace('/register-role');
    }
  }, [router]);

  // Silent auto-poll: every few seconds, hit Firebase to see if user clicked the link.
  useEffect(() => {
    if (!autoChecking || verified) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const ok = await refreshVerificationStatus();
        if (cancelled) return;
        if (ok) {
          setVerified(true);
          setStatusMsg('Email verified! Taking you in…');
          setErrorMsg(null);
          setTimeout(() => {
            proceedAfterVerified();
          }, 900);
        }
      } catch {
        /* silent — manual button still available */
      }
    };
    const id = setInterval(tick, AUTO_POLL_INTERVAL_MS);
    const initial = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(initial);
    };
  }, [autoChecking, verified, proceedAfterVerified]);

  const handleCheck = async () => {
    setStatusMsg(null);
    setErrorMsg(null);
    setBusy(true);
    try {
      const ok = await refreshVerificationStatus();
      if (!ok) {
        setErrorMsg(
          'Not yet verified. Open the link in your email (check Spam folder too), then tap this button again.',
        );
        return;
      }
      setVerified(true);
      setStatusMsg('Email verified! Taking you in…');
      setTimeout(() => {
        proceedAfterVerified();
      }, 600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not refresh status.';
      setErrorMsg(msg);
      Alert.alert('Error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setStatusMsg(null);
    setErrorMsg(null);
    setResending(true);
    try {
      await resendVerificationEmail();
      setStatusMsg(
        `Verification email resent to ${email}. Check Spam / Promotions if it doesn't arrive within a minute.`,
      );
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Try again later.';
      const friendly = raw.includes('too-many-requests')
        ? 'Too many requests. Please wait a minute, then try again.'
        : raw;
      setErrorMsg(friendly);
      Alert.alert('Could not resend', friendly);
    } finally {
      setResending(false);
    }
  };

  const handleOpenGmail = async () => {
    // Best-effort: try the Gmail app first on mobile, then web fallback.
    const tryUrls: string[] = [];
    if (Platform.OS === 'ios') tryUrls.push('googlegmail://');
    if (Platform.OS === 'android') tryUrls.push('googlegmail://co');
    tryUrls.push('https://mail.google.com/mail/u/0/#inbox');
    for (const url of tryUrls) {
      try {
        const can = await Linking.canOpenURL(url);
        if (can) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        /* try next */
      }
    }
    try {
      await Linking.openURL('https://mail.google.com');
    } catch {
      Alert.alert('Cannot open Gmail', 'Please open your email app manually.');
    }
  };

  const handleSignOut = async () => {
    await signOutFirebase();
    router.replace('/login');
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={[styles.iconWrap, verified && styles.iconWrapSuccess]}>
        <MaterialCommunityIcons
          name={verified ? 'check-circle-outline' : 'email-check-outline'}
          size={48}
          color={verified ? Colors.success : Colors.primaryDark}
        />
      </View>

      <Text style={styles.title}>
        {verified ? 'Email verified!' : 'Verify your email'}
      </Text>
      <Text style={styles.subtitle}>
        {verified ? (
          'Welcome aboard. Setting things up…'
        ) : (
          <>
            We sent a verification link to{'\n'}
            <Text style={styles.email}>{email || '(no email)'}</Text>
          </>
        )}
      </Text>

      {!verified && (
        <Card variant="outline" style={styles.infoCard}>
          <View style={styles.autoRow}>
            {autoChecking ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <MaterialCommunityIcons
                name="pause-circle-outline"
                size={16}
                color={Colors.textSecondary}
              />
            )}
            <Text style={styles.autoText}>
              {autoChecking
                ? `Auto-checking every ${Math.round(AUTO_POLL_INTERVAL_MS / 1000)}s…`
                : 'Auto-check paused'}
            </Text>
            <TouchableOpacity onPress={() => setAutoChecking((v) => !v)} hitSlop={8}>
              <Text style={styles.autoToggle}>
                {autoChecking ? 'Pause' : 'Resume'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.tip}>
            Open the link in your email, then come back — we detect it automatically.
          </Text>
          <View style={styles.spamHint}>
            <MaterialCommunityIcons name="alert-outline" size={14} color={Colors.warning} />
            <Text style={styles.spamHintText}>
              Check Spam / Promotions — sent from noreply@insectra-ccb58.firebaseapp.com
            </Text>
          </View>
        </Card>
      )}

      {errorMsg && (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}
      {statusMsg && (
        <View style={[styles.infoBanner, verified && styles.successBanner]}>
          <MaterialCommunityIcons
            name={verified ? 'check-circle' : 'information-outline'}
            size={18}
            color={verified ? Colors.success : Colors.primary}
          />
          <Text style={[styles.infoBannerText, verified && styles.successBannerText]}>
            {statusMsg}
          </Text>
        </View>
      )}

      {!verified && (
        <View style={styles.actions}>
          <Button
            label="Open Gmail"
            icon="gmail"
            variant="secondary"
            onPress={handleOpenGmail}
            fullWidth
          />
          <Button
            label="I've verified my email"
            icon="refresh"
            loading={busy}
            onPress={handleCheck}
            fullWidth
          />
          <Button
            label={
              resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : 'Resend verification email'
            }
            icon="email-fast-outline"
            variant="ghost"
            loading={resending}
            disabled={resendCooldown > 0}
            onPress={handleResend}
            fullWidth
          />
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} hitSlop={8}>
            <Text style={styles.signOutText}>Use a different account</Text>
          </TouchableOpacity>
        </View>
      )}

      {verified && (
        <View style={styles.verifiedSpinnerWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    content: { alignItems: 'center', paddingTop: Spacing.xxxl, gap: Spacing.md },
    iconWrap: {
      width: 80,
      height: 80,
      borderRadius: Radius.full,
      backgroundColor: Colors.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    iconWrapSuccess: { backgroundColor: Colors.successBg },
    title: { ...Type.h1, color: Colors.primaryDark, textAlign: 'center' },
    subtitle: {
      ...Type.body,
      color: Colors.textSecondary,
      textAlign: 'center',
    },
    email: { ...Type.bodyStrong, color: Colors.textPrimary },
    infoCard: { width: '100%', gap: Spacing.sm },
    autoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    autoText: { ...Type.caption, color: Colors.textSecondary, flex: 1 },
    autoToggle: {
      ...Type.caption,
      color: Colors.primary,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
    tip: {
      ...Type.caption,
      color: Colors.textSecondary,
      lineHeight: 17,
    },
    spamHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
      backgroundColor: Colors.warningBg,
      borderRadius: Radius.md,
      padding: Spacing.sm,
    },
    spamHintText: { flex: 1, ...Type.caption, color: Colors.warning, lineHeight: 16 },
    actions: { width: '100%', gap: Spacing.sm },
    signOutBtn: { paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.xs },
    signOutText: {
      ...Type.caption,
      color: Colors.textSecondary,
      textDecorationLine: 'underline',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: Colors.dangerBg,
      width: '100%',
    },
    errorBannerText: { flex: 1, ...Type.caption, color: Colors.danger, lineHeight: 17 },
    infoBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: Colors.primaryFaint,
      width: '100%',
    },
    infoBannerText: { flex: 1, ...Type.caption, color: Colors.primary, lineHeight: 17 },
    successBanner: { backgroundColor: Colors.successBg },
    successBannerText: { color: Colors.primaryDark, fontWeight: '700' },
    verifiedSpinnerWrap: { marginTop: Spacing.lg },
  });
