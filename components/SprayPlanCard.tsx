/**
 * SprayPlanCard
 * =============
 *
 * One-tap spray decision for the farmer. Pulls live risk + history from
 * Firestore and renders a colour-coded recommendation:
 *
 *   green  — NO ACTION (don't spray, save money)
 *   amber  — WAIT N DAYS (with reason; may be residual window or below ETL)
 *   red    — SPRAY NOW (cost & estimated avoided loss shown)
 *   grey   — INSUFFICIENT DATA (sensors not reporting yet)
 *
 * Backed by services/sprayAdvisor.ts which combines FAO/IAEA action
 * thresholds, Vargas 2008 spinosad residual decay, and a Pedigo–Higley
 * style cost guardrail.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import {
  buildSprayDecision,
  computeSprayCostPhp,
  getLastSpray,
  loadSpraySettings,
  logSprayEvent,
  type SprayDecision,
  type SprayEvent,
  type SpraySettings,
} from '@/services/sprayAdvisor';
import type { RiskResult } from '@/services/riskScoring';
import { getCurrentAppUser } from '@/services/firebaseAuth';
import { toast } from '@/services/eventBus';

interface Props {
  farmId: string;
  farmName: string;
  deviceId?: string | null;
  risk: RiskResult | null;
  dailyCount: number | null;
  countHistory: number[]; // oldest first
  onOpenSettings: () => void;
}

export default function SprayPlanCard({
  farmId,
  farmName,
  deviceId,
  risk,
  dailyCount,
  countHistory,
  onOpenSettings,
}: Props) {
  const styles = useThemeStyles(makeStyles);
  const [settings, setSettings] = useState<SpraySettings | null>(null);
  const [lastSpray, setLastSpray] = useState<SprayEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadSpraySettings(farmId), getLastSpray(farmId)])
      .then(([s, l]) => {
        if (!alive) return;
        setSettings(s);
        setLastSpray(l);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [farmId, refreshTick]);

  const decision: SprayDecision | null = useMemo(() => {
    if (!risk) return null;
    return buildSprayDecision({
      risk,
      countHistory,
      dailyCount,
      settings,
      lastSpray,
    });
  }, [risk, countHistory, dailyCount, settings, lastSpray]);

  const handleLogSpray = async () => {
    if (logging || !settings) return;
    const me = getCurrentAppUser();
    if (!me) return;
    const liters = Math.max(0, settings.areaHectares) * Math.max(0, settings.doseLitersPerHectare);
    const cost = computeSprayCostPhp(settings);
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(
            `Log spray on ${farmName}?\n\n${settings.productName}\n${liters.toFixed(2)} L · ₱${cost.toLocaleString()}`,
          )
        : true;
    if (!ok) return;
    setLogging(true);
    try {
      await logSprayEvent({
        farmId,
        byUid: me.uid,
        byName: me.fullName || me.email || 'farmer',
        product: settings.productName,
        litersUsed: liters,
        costPhp: cost,
        deviceId: deviceId ?? null,
        riskScoreAtSpray: risk?.score ?? null,
        riskLevelAtSpray: risk?.level ?? null,
        dailyCountAtSpray: dailyCount,
        forecast3dAtSpray: risk?.projectedRisk3d ?? null,
        decisionHeadline: decision?.headline ?? null,
        decisionReason: decision?.reason ?? null,
        reviewDueAtMs: Date.now() + 6 * 60 * 60_000,
      });
      setRefreshTick((n) => n + 1);
      toast.ok(
        'spray',
        'Spray logged',
        `${settings.productName} \u2022 ${liters.toFixed(2)} L \u2022 \u20b1${cost.toLocaleString()}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not log spray.';
      toast.err('spray', 'Could not log spray', msg);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(msg);
      }
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.card, { borderColor: Colors.borderLight, backgroundColor: Colors.surface }]}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  if (!decision) {
    return (
      <View style={[styles.card, { borderColor: Colors.borderLight, backgroundColor: Colors.surface }]}>
        <View style={styles.headerRow}>
          <MaterialCommunityIcons name="spray-bottle" size={18} color={Colors.textSecondary} />
          <Text style={[styles.title, { color: Colors.textSecondary }]}>Spray Plan</Text>
        </View>
        <Text style={styles.body}>Waiting for trap + sensor data before recommending a spray plan.</Text>
        <TouchableOpacity onPress={onOpenSettings} style={styles.linkBtn} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10 }}>
          <MaterialCommunityIcons name="cog-outline" size={14} color={Colors.primaryDark} />
          <Text style={styles.linkBtnText}>Set up pesticide & cost</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tone = toneFor(decision.action);

  return (
    <View style={[styles.card, { borderColor: tone.border, backgroundColor: tone.bg }]}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name={tone.icon as any} size={18} color={tone.fg} />
        <Text style={[styles.title, { color: tone.fg }]}>Spray Plan · {farmName}</Text>
      </View>

      <Text style={[styles.headline, { color: tone.fg }]}>{decision.headline}</Text>
      <Text style={styles.body}>{decision.reason}</Text>

      {/* Cost + benefit row when settings are present */}
      {decision.costPhp !== null && (
        <View style={styles.costRow}>
          <View style={styles.costCell}>
            <Text style={styles.costLabel}>Cost / spray</Text>
            <Text style={styles.costValue}>₱{decision.costPhp.toLocaleString()}</Text>
          </View>
          {decision.lossAvoidedPhp !== null && (
            <View style={styles.costCell}>
              <Text style={styles.costLabel}>Loss avoided ≈</Text>
              <Text style={[styles.costValue, { color: Colors.primaryDark }]}>
                ₱{decision.lossAvoidedPhp.toLocaleString()}
              </Text>
            </View>
          )}
          {decision.netBenefitPhp !== null && (
            <View style={styles.costCell}>
              <Text style={styles.costLabel}>Net benefit</Text>
              <Text
                style={[
                  styles.costValue,
                  { color: decision.netBenefitPhp >= 0 ? Colors.primaryLight : Colors.danger },
                ]}
              >
                {decision.netBenefitPhp >= 0 ? '+' : ''}₱{decision.netBenefitPhp.toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Last spray context */}
      {lastSpray && (
        <Text style={styles.lastSpray}>
          Last spray: {timeAgo(lastSpray.performedAt)} · {lastSpray.litersUsed.toFixed(2)} L · ₱
          {lastSpray.costPhp.toLocaleString()}
        </Text>
      )}

      {/* Actions */}
      <View style={styles.actionRow}>
        {decision.action === 'spray_now' && settings && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: tone.fg }, logging && { opacity: 0.7 }]}
            onPress={handleLogSpray}
            disabled={logging}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="check-circle-outline" size={14} color="#fff" />
            <Text style={styles.primaryBtnText}>{logging ? 'Saving…' : 'I sprayed today'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onOpenSettings} style={styles.linkBtn} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10 }}>
          <MaterialCommunityIcons name="cog-outline" size={14} color={Colors.primaryDark} />
          <Text style={styles.linkBtnText}>
            {settings ? 'Edit pesticide & cost' : 'Set up pesticide & cost'}
          </Text>
        </TouchableOpacity>
      </View>

      {decision.downgradedForCost && (
        <Text style={styles.guardrail}>
          ⓘ Cost guardrail engaged — would lose money to spray now at this outbreak size.
        </Text>
      )}
    </View>
  );
}

function toneFor(action: SprayDecision['action']) {
  switch (action) {
    case 'spray_now':
      return {
        bg: '#FEEFEC',
        border: '#C0392B',
        fg: '#922B21',
        icon: 'spray',
      };
    case 'wait':
      return {
        bg: '#FFF8E5',
        border: '#D4A017',
        fg: '#7C4A00',
        icon: 'timer-sand',
      };
    case 'no_action':
      return {
        bg: '#E8F4EE',
        border: '#2D6A4F',
        fg: '#1B4332',
        icon: 'check-circle-outline',
      };
    default:
      return {
        bg: Colors.surface,
        border: Colors.borderLight,
        fg: Colors.textSecondary,
        icon: 'help-circle-outline',
      };
  }
}

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) {
    const hrs = Math.floor(ms / 3_600_000);
    return hrs <= 0 ? 'just now' : `${hrs}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

const makeStyles = () => StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '700' },
  headline: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  body: { fontSize: 12, lineHeight: 17, color: Colors.textPrimary },

  costRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#00000022',
  },
  costCell: { flex: 1 },
  costLabel: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  costValue: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },

  lastSpray: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  linkBtnText: { color: Colors.primaryDark, fontWeight: '700', fontSize: 12 },

  guardrail: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
});
