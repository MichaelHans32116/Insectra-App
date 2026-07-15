import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius } from '@/constants/theme';
import { useActiveGroup } from '@/services/activeGroup';
import { useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';

export default function FarmAccessBar() {
  const router = useRouter();
  const { active, groups, setActiveById } = useActiveGroup();
  const [pickerOpen, setPickerOpen] = useState(false);
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const roleLabel = (role: string) => role === 'Farm Owner'
    ? text('Farm Owner', 'May-ari ng sakahan')
    : text('Farm Member', 'Miyembro ng sakahan');

  const handlePick = async (groupId: string) => {
    await setActiveById(groupId);
    setPickerOpen(false);
  };

  return (
    <>
      <View style={styles.wrap}>
        <TouchableOpacity
          style={styles.groupCard}
          activeOpacity={0.85}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={active ? `Active farm: ${active.name}` : text('No farm selected', 'Walang napiling sakahan')}
          accessibilityHint={text('Open the farm switcher.', 'Buksan ang palitan ng sakahan.')}
        >
          <View style={styles.groupIconWrap}>
            <MaterialCommunityIcons
              name={active?.role === 'Farm Owner' ? 'crown-outline' : 'account-group-outline'}
              size={18}
              color={Colors.primaryDark}
            />
          </View>
          <View style={styles.groupCopy}>
            <Text style={styles.eyebrow}>{active ? text('ACTIVE FARM', 'AKTIBONG SAKAHAN') : text('NO FARM SELECTED', 'WALANG NAPILING SAKAHAN')}</Text>
            <Text style={styles.groupName} numberOfLines={1}>
              {active?.name ?? text('Choose, create, or join a farm', 'Pumili, gumawa, o sumali sa sakahan')}
            </Text>
            <Text style={styles.groupMeta} numberOfLines={1}>
              {active
                ? `${roleLabel(active.role)} • ${groups.length} ${text(groups.length === 1 ? 'community' : 'communities', groups.length === 1 ? 'komunidad' : 'mga komunidad')}`
                : text('Tap here to choose or set up your first farm.', 'Pindutin ito para pumili o gumawa ng una mong sakahan.')}
            </Text>
          </View>
          <MaterialCommunityIcons name="swap-horizontal" size={18} color={Colors.primaryDark} />
        </TouchableOpacity>

        <View style={styles.actionColumn}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/settings' as any)}
            accessibilityRole="button"
            accessibilityLabel={text('Open settings', 'Buksan ang settings')}
          >
            <MaterialCommunityIcons name="cog-outline" size={18} color={Colors.primaryDark} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/profile' as any)}
            accessibilityRole="button"
            accessibilityLabel={text('Open profile', 'Buksan ang profile')}
          >
            <MaterialCommunityIcons name="account-circle-outline" size={18} color={Colors.primaryDark} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{text('My farms and teams', 'Aking mga sakahan at team')}</Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={text('Close farm switcher', 'Isara ang palitan ng sakahan')}
              >
                <MaterialCommunityIcons name="close" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {groups.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialCommunityIcons name="account-group-outline" size={28} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>{text('No farms yet', 'Wala pang sakahan')}</Text>
                <Text style={styles.emptyBody}>
                  {text('Create your own farm or join a team with an invite code.', 'Gumawa ng sariling sakahan o sumali sa team gamit ang invite code.')}
                </Text>
              </View>
            ) : (
              groups.map((group, index) => {
                const isActive = active?.id === group.id;
                return (
                  <TouchableOpacity
                    key={group.id}
                    style={[styles.groupRow, index > 0 && styles.groupRowDivider]}
                    activeOpacity={0.85}
                    onPress={() => handlePick(group.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.name}, ${roleLabel(group.role)}${isActive ? ', active' : ''}`}
                  >
                    <MaterialCommunityIcons
                      name={group.role === 'Farm Owner' ? 'crown' : 'account-group'}
                      size={18}
                      color={Colors.primaryDark}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupRowName}>{group.name}</Text>
                      <Text style={styles.groupRowMeta}>{roleLabel(group.role)}</Text>
                    </View>
                    {isActive ? (
                      <View style={styles.activePill}>
                        <Text style={styles.activePillText}>{text('Active', 'Aktibo')}</Text>
                      </View>
                    ) : (
                      <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textTertiary} />
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                activeOpacity={0.85}
                onPress={() => {
                  setPickerOpen(false);
                  router.push('/join-group' as any);
                }}
                accessibilityRole="button"
                accessibilityLabel={text('Join a farm team', 'Sumali sa team ng sakahan')}
              >
                <MaterialCommunityIcons name="account-multiple-plus" size={16} color={Colors.primaryDark} />
                <Text style={styles.secondaryBtnText}>{text('Join', 'Sumali')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.85}
                onPress={() => {
                  setPickerOpen(false);
                  router.push('/create-group' as any);
                }}
                accessibilityRole="button"
                accessibilityLabel={text('Create a farm', 'Gumawa ng sakahan')}
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={16} color={Colors.textOnPrimary} />
                <Text style={styles.primaryBtnText}>{text('Create', 'Gumawa')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = () => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginBottom: 14,
  },
  groupCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  groupIconWrap: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Colors.textTertiary,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.primaryDark,
    marginTop: 2,
  },
  groupMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  actionColumn: {
    gap: 10,
  },
  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(12, 26, 18, 0.36)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: Colors.primaryDark,
  },
  emptyBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  emptyBody: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  groupRowDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  groupRowName: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  groupRowMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryDark,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textOnPrimary,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
  },
  secondaryBtnText: {
    color: Colors.primaryDark,
    fontWeight: '800',
    fontSize: 13,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
  },
  primaryBtnText: {
    color: Colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
});
