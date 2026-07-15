import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { loadSession } from '@/services/auth';
import { listGroupsForUser } from '@/services/groups';

/**
 * Role chooser shown:
 *  - After fresh registration + email verification (user has no group yet)
 *  - When a signed-in user wants to add another group/farm
 *
 * The choice does NOT change the Firebase user — it just decides whether
 * the next screen is "Create your farm" (Owner) or "Join existing farm"
 * (Member). A user can be Owner of one farm and Member of another.
 */
export default function RegisterRoleScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [hasAnyGroup, setHasAnyGroup] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      if (!session.emailVerified) {
        router.replace('/verify-email');
        return;
      }
      setHasSession(true);
      try {
        const groups = await listGroupsForUser(session.uid);
        setHasAnyGroup(groups.length > 0);
      } catch {
        setHasAnyGroup(false);
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading || !hasSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      {/* Header with back button — even on the role-pick screen, the user
          may want to go back (e.g., to switch accounts or correct their email). */}
      <View style={styles.header}>
        <Button
          label=""
          accessibilityLabel="Go back"
          icon="arrow-left"
          variant="ghost"
          size="sm"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/login');
          }}
          style={styles.backBtn}
        />
        <Text style={styles.headerTitle}>Choose your role</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>How will you use InsecTra?</Text>
        <Text style={styles.subtitle}>Pick the role that fits. You can add more farms later.</Text>
      </View>

      <Card variant="elevated" onPress={() => router.push('/create-group')} accessibilityLabel="I'm an Insectra Owner">
        <View style={[styles.iconWrap, { backgroundColor: Colors.primaryTint }]}>
          <MaterialCommunityIcons name="crown-outline" size={28} color={Colors.primaryDark} />
        </View>
        <Text style={styles.cardTitle}>I'm an Insectra Owner</Text>
        <Text style={styles.cardBody}>You have a Pi device — create a farm, register traps, and invite your team.</Text>
        <Bullet icon="check" text="Register Pi devices (e.g. INSECTRA-PI-001)" styles={styles} />
        <Bullet icon="check" text="Pin device location on map" styles={styles} />
        <Bullet icon="check" text="Toggle live detection / camera" styles={styles} />
        <Bullet icon="check" text="Invite members via 6-character code" styles={styles} />
      </Card>

      <Card variant="elevated" onPress={() => router.push('/join-group')} accessibilityLabel="I'm a Member">
        <View style={[styles.iconWrap, { backgroundColor: Colors.surfaceAlt }]}>
          <MaterialCommunityIcons name="account-group-outline" size={28} color={Colors.primaryDark} />
        </View>
        <Text style={styles.cardTitle}>I'm a Member</Text>
        <Text style={styles.cardBody}>Join an existing farm with an invite code to view dashboards and the feed.</Text>
        <Bullet icon="check" text="View shared dashboards & analytics" styles={styles} />
        <Bullet icon="check" text="Post & reply in community feed" styles={styles} />
        <Bullet icon="information-outline" text="Become an Owner later if you get a Pi." muted styles={styles} />
      </Card>

      {hasAnyGroup && (
        <Button
          label="Back to my dashboard"
          variant="secondary"
          fullWidth
          onPress={() => router.replace('/dashboard')}
        />
      )}
    </Screen>
  );
}

function Bullet({
  icon,
  text,
  muted,
  styles,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  text: string;
  muted?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.bullet}>
      <MaterialCommunityIcons
        name={icon}
        size={14}
        color={muted ? Colors.textSecondary : Colors.primary}
      />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    loading: {
      flex: 1,
      backgroundColor: Colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    backBtn: { width: 44, minWidth: 0, paddingHorizontal: 0 },
    headerTitle: { flex: 1, ...Type.label, color: Colors.textPrimary, textAlign: 'center' },
    intro: { gap: Spacing.xs },
    title: { ...Type.h1, color: Colors.primaryDark },
    subtitle: { ...Type.body, color: Colors.textSecondary },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    cardTitle: { ...Type.title, color: Colors.textPrimary, marginBottom: Spacing.xs },
    cardBody: { ...Type.caption, color: Colors.textSecondary, marginBottom: Spacing.sm },
    bullet: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: Spacing.xs },
    bulletText: { flex: 1, ...Type.caption, color: Colors.textPrimary },
  });
