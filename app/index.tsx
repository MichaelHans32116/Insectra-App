import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { loadSession } from '@/services/auth';
import { listGroupsForUser } from '@/services/groups';
import { DESIGN_MODE } from '@/constants/designMode';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (DESIGN_MODE) {
        setTarget('/dashboard');
        return;
      }
      const session = await loadSession();
      if (!session) {
        setTarget('/login');
        return;
      }
      if (!session.emailVerified) {
        setTarget('/verify-email');
        return;
      }
      try {
        const groups = await listGroupsForUser(session.uid);
        setTarget(groups.length > 0 ? '/dashboard' : '/register-role');
      } catch {
        // If we can't reach Firestore, still let the user into the role chooser.
        setTarget('/register-role');
      }
    })();
  }, []);

  if (!target) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: Colors.background,
        }}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return <Redirect href={target as any} />;
}