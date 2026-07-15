import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import FarmAccessBar from '@/components/FarmAccessBar';
import { Card, Button, Badge, EmptyState } from '@/components/ui';
import { useActiveGroup } from '@/services/activeGroup';
import { getLocale, pickLocale, useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';
import {
  deletePost,
  deleteReply,
  postAnnouncement,
  postReply,
  subscribePosts,
  subscribeReplies,
  togglePostLike,
  toggleReplyLike,
  type CommunityPost,
  type CommunityReply,
} from '@/services/community';
import { getCurrentAppUser } from '@/services/firebaseAuth';
import { toast } from '@/services/eventBus';

function relativeTime(d: Date | null): string {
  const locale = getLocale();
  if (!d) return '…';
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return pickLocale('just now', 'ngayon lang', locale);
  if (m < 60) return locale === 'tl' ? `${m}m nakalipas` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === 'tl' ? `${h}h nakalipas` : `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return locale === 'tl' ? `${days}d nakalipas` : `${days}d ago`;
  return d.toLocaleDateString(locale === 'tl' ? 'fil-PH' : undefined);
}

function normalizeCommunityError(error: unknown): string {
  const locale = getLocale();
  const raw = error instanceof Error ? error.message : 'Try again.';
  const lower = raw.toLowerCase();
  if (
    lower.includes('missing or insufficient permissions')
    || lower.includes('permission-denied')
    || lower.includes('insufficient permissions')
  ) {
    return pickLocale(
      'Community is for verified members of this farm. If you just verified your email, sign out and back in.',
      'Para sa verified na miyembro lang ang community. Kung kakaverify mo lang, mag-sign out at sign in ulit.',
      locale,
    );
  }
  return raw;
}

function roleLabel(role: string, text: (en: string, tl: string) => string): string {
  return role === 'Farm Owner'
    ? text('Owner', 'May-ari')
    : text('Member', 'Miyembro');
}

type BrowserDialogs = {
  alert?: (message: string) => void;
  confirm?: (message: string) => boolean;
};

function browserDialogs(): BrowserDialogs {
  return globalThis as unknown as BrowserDialogs;
}

export default function CommunityScreen() {
  const router = useRouter();
  const { active, loading } = useActiveGroup();
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const hPad = width < 360 ? Spacing.md : width > 720 ? Spacing.xxl : Spacing.lg;
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommunityPost | null>(null);

  useEffect(() => {
    if (!active) {
      setPosts([]);
      setPostsLoading(false);
      setPostsError(null);
      return;
    }
    setPostsLoading(true);
    setPostsError(null);
    const unsub = subscribePosts(
      active.id,
      (next) => {
        setPosts(next);
        setPostsLoading(false);
        setPostsError(null);
      },
      (error) => {
        const msg = normalizeCommunityError(error);
        setPosts([]);
        setPostsLoading(false);
        setPostsError(msg);
        toast.err('community', 'Could not load community', msg);
      },
    );
    return unsub;
  }, [active?.id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!active) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon="forum-outline"
          title={text('No farm community yet', 'Wala pang community')}
          body={text('Join or create a farm to see the feed.', 'Sumali o gumawa ng sakahan para makita ang feed.')}
          actionLabel={text('Get started', 'Magsimula')}
          onAction={() => router.push('/register-role')}
        />
      </View>
    );
  }

  const feedContent = { width: '100%' as const, maxWidth: 640, alignSelf: 'center' as const, paddingHorizontal: hPad };

  return (
    <View style={styles.container}>
      <View style={[styles.topBarWrap, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
        <View style={feedContent}>
          <FarmAccessBar />
        </View>
      </View>

      <View style={styles.header}>
        <View style={[feedContent, styles.headerInner]}>
          <View style={styles.flex1}>
            <Text style={styles.headerTitle} numberOfLines={1}>{active.name}</Text>
            <Text style={styles.headerSub}>{text('Community feed', 'Feed ng komunidad')} · {posts.length}</Text>
          </View>
          <Button label={text('Post', 'Mag-post')} icon="pencil" size="sm" onPress={() => setComposerOpen(true)} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[feedContent, styles.feed, { paddingBottom: Math.max(insets.bottom + Spacing.xxl, 96) }]}
        showsVerticalScrollIndicator={false}
      >
        {postsLoading ? (
          <ActivityIndicator color={Colors.primary} style={styles.feedLoader} />
        ) : postsError ? (
          <Card>
            <EmptyState icon="alert-circle-outline" title={text('Could not load', 'Hindi ma-load')} body={postsError} />
          </Card>
        ) : posts.length === 0 ? (
          <Card>
            <EmptyState
              icon="message-outline"
              title={text('No posts yet', 'Wala pang post')}
              body={text('Be the first — share an update or ask the community.', 'Mauna ka — magbahagi o magtanong sa komunidad.')}
              actionLabel={text('Write a post', 'Sumulat')}
              onAction={() => setComposerOpen(true)}
            />
          </Card>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              farmId={active.id}
              isFarmOwner={active.role === 'Farm Owner'}
              onReply={() => setReplyTarget(p)}
            />
          ))
        )}
      </ScrollView>

      <ComposerModal
        visible={composerOpen}
        farmId={active.id}
        replyTo={null}
        onClose={() => setComposerOpen(false)}
      />
      <ComposerModal
        visible={!!replyTarget}
        farmId={active.id}
        replyTo={replyTarget}
        onClose={() => setReplyTarget(null)}
      />
    </View>
  );
}

// ── Post Card ────────────────────────────────────────────────────────────
function PostCard(props: {
  post: CommunityPost;
  farmId: string;
  isFarmOwner: boolean;
  onReply: () => void;
}) {
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const { post, farmId, isFarmOwner } = props;
  const me = getCurrentAppUser();
  const myUid = me?.uid ?? '';
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<CommunityReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!showReplies) return;
    setRepliesLoading(true);
    setReplyError(null);
    const unsub = subscribeReplies(
      farmId,
      post.id,
      (next) => {
        setReplies(next);
        setRepliesLoading(false);
        setReplyError(null);
      },
      (error) => {
        const msg = normalizeCommunityError(error);
        setReplies([]);
        setRepliesLoading(false);
        setReplyError(msg);
        toast.err('community', 'Could not load replies', msg);
      },
    );
    return unsub;
  }, [farmId, post.id, showReplies]);

  const liked = !!myUid && post.likedBy.includes(myUid);
  const likeCount = post.likedBy.length;
  const canDeletePost = !!myUid && (post.authorUid === myUid || isFarmOwner);

  const handleToggleLike = async () => {
    if (!myUid || likeBusy) return;
    setLikeBusy(true);
    try {
      await togglePostLike({ farmId, postId: post.id, uid: myUid, liked });
      toast.ok('community', liked ? text('Removed like', 'Inalis ang like') : text('Liked post', 'Na-like'));
    } catch (e) {
      toast.err('community', text('Like failed', 'Hindi nagtagumpay'), e instanceof Error ? e.message : undefined);
    } finally {
      setLikeBusy(false);
    }
  };

  const handleDeletePost = () => {
    if (deleteBusy) return;
    const proceed = async () => {
      setDeleteBusy(true);
      try {
        await deletePost({ farmId, postId: post.id });
        toast.ok('community', text('Post deleted', 'Nabura ang post'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : text('Could not delete post.', 'Hindi mabura.');
        toast.err('community', text('Delete failed', 'Hindi nabura'), msg);
        const dialogs = browserDialogs();
        if (typeof dialogs.alert === 'function') {
          dialogs.alert(msg);
        }
      } finally {
        setDeleteBusy(false);
      }
    };
    const dialogs = browserDialogs();
    if (typeof dialogs.confirm === 'function') {
      if (dialogs.confirm(text('Delete this post? Replies will also be removed.', 'Burahin ang post? Mabubura rin ang mga reply.'))) proceed();
    } else {
      Alert.alert(text('Delete post?', 'Burahin?'), text('Replies will also be removed.', 'Mabubura rin ang mga reply.'), [
        { text: text('Cancel', 'Kanselahin'), style: 'cancel' },
        { text: text('Delete', 'Burahin'), style: 'destructive', onPress: proceed },
      ]);
    }
  };

  return (
    <Card variant="elevated" style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(post.authorName || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.flex1}>
          <Text style={styles.postAuthor} numberOfLines={1}>{post.authorName}</Text>
          <View style={styles.postMetaRow}>
            <Badge label={roleLabel(post.authorRole, text)} tone="info" />
            <Text style={styles.postTime}>{relativeTime(post.createdAt)}</Text>
          </View>
        </View>
        {canDeletePost && (
          <TouchableOpacity onPress={handleDeletePost} hitSlop={10} disabled={deleteBusy} accessibilityRole="button" accessibilityLabel={text('Delete post', 'Burahin ang post')} style={{ padding: Spacing.xs, opacity: deleteBusy ? 0.5 : 1 }}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={Colors.danger} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      <View style={styles.postActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleToggleLike} disabled={!myUid || likeBusy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }}>
          <MaterialCommunityIcons name={liked ? 'heart' : 'heart-outline'} size={15} color={liked ? Colors.danger : Colors.primaryDark} />
          <Text style={[styles.actionText, liked && { color: Colors.danger }]}>
            {likeCount > 0 ? `${likeCount} ` : ''}{liked ? text('Liked', 'Na-like') : text('Like', 'Like')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowReplies((s) => !s)} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }}>
          <MaterialCommunityIcons name={showReplies ? 'chevron-up' : 'comment-outline'} size={15} color={Colors.primaryDark} />
          <Text style={styles.actionText}>{showReplies ? text('Hide', 'Itago') : text('Replies', 'Reply')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={props.onReply} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }}>
          <MaterialCommunityIcons name="reply" size={15} color={Colors.primaryDark} />
          <Text style={styles.actionText}>{text('Reply', 'Reply')}</Text>
        </TouchableOpacity>
      </View>

      {showReplies && (
        <View style={styles.repliesBox}>
          {repliesLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : replyError ? (
            <Text style={styles.noRepliesText}>{replyError}</Text>
          ) : replies.length === 0 ? (
            <Text style={styles.noRepliesText}>{text('No replies yet — be the first.', 'Wala pang reply — mauna ka.')}</Text>
          ) : (
            replies.map((r) => (
              <ReplyRow key={r.id} reply={r} farmId={farmId} postId={post.id} myUid={myUid} isFarmOwner={isFarmOwner} />
            ))
          )}
        </View>
      )}
    </Card>
  );
}

// ── Reply Row ────────────────────────────────────────────────────────────
function ReplyRow(props: {
  reply: CommunityReply;
  farmId: string;
  postId: string;
  myUid: string;
  isFarmOwner: boolean;
}) {
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const { reply: r, farmId, postId, myUid, isFarmOwner } = props;
  const liked = !!myUid && r.likedBy.includes(myUid);
  const likeCount = r.likedBy.length;
  const canDelete = !!myUid && (r.authorUid === myUid || isFarmOwner);
  const [busy, setBusy] = useState(false);

  const onLike = async () => {
    if (!myUid || busy) return;
    setBusy(true);
    try {
      await toggleReplyLike({ farmId, postId, replyId: r.id, uid: myUid, liked });
      toast.ok('community', liked ? text('Removed like', 'Inalis ang like') : text('Liked reply', 'Na-like'));
    } catch (e) {
      toast.err('community', text('Like failed', 'Hindi nagtagumpay'), e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    const proceed = async () => {
      setBusy(true);
      try {
        await deleteReply({ farmId, postId, replyId: r.id });
        toast.ok('community', text('Reply deleted', 'Nabura ang reply'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : text('Could not delete reply.', 'Hindi mabura.');
        toast.err('community', text('Delete failed', 'Hindi nabura'), msg);
        const dialogs = browserDialogs();
        if (typeof dialogs.alert === 'function') {
          dialogs.alert(msg);
        }
      } finally {
        setBusy(false);
      }
    };
    const dialogs = browserDialogs();
    if (typeof dialogs.confirm === 'function') {
      if (dialogs.confirm(text('Delete this reply?', 'Burahin ang reply?'))) proceed();
    } else {
      Alert.alert(text('Delete reply?', 'Burahin?'), '', [
        { text: text('Cancel', 'Kanselahin'), style: 'cancel' },
        { text: text('Delete', 'Burahin'), style: 'destructive', onPress: proceed },
      ]);
    }
  };

  return (
    <View style={styles.replyRow}>
      <View style={[styles.avatar, styles.avatarSmall]}>
        <Text style={styles.avatarText}>{(r.authorName || '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.flex1}>
        <Text style={styles.replyAuthor}>
          {r.authorName}{' '}
          <Text style={styles.replyTime}>· {relativeTime(r.createdAt)}</Text>
        </Text>
        <Text style={styles.replyBody}>{r.body}</Text>
        <View style={styles.replyActions}>
          <TouchableOpacity onPress={onLike} disabled={!myUid || busy} accessibilityRole="button" hitSlop={10} style={styles.replyActionBtn}>
            <MaterialCommunityIcons name={liked ? 'heart' : 'heart-outline'} size={12} color={liked ? Colors.danger : Colors.textSecondary} />
            <Text style={[styles.replyTime, liked && { color: Colors.danger }]}>
              {likeCount > 0 ? `${likeCount} ` : ''}{liked ? text('Liked', 'Na-like') : text('Like', 'Like')}
            </Text>
          </TouchableOpacity>
          {canDelete && (
            <TouchableOpacity onPress={onDelete} disabled={busy} accessibilityRole="button" hitSlop={10} style={styles.replyActionBtn}>
              <MaterialCommunityIcons name="trash-can-outline" size={12} color={Colors.danger} />
              <Text style={[styles.replyTime, { color: Colors.danger }]}>{text('Delete', 'Burahin')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Composer Modal ───────────────────────────────────────────────────────
function ComposerModal(props: {
  visible: boolean;
  farmId: string;
  replyTo: CommunityPost | null;
  onClose: () => void;
}) {
  const { active } = useActiveGroup();
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.visible) setBody('');
  }, [props.visible]);

  const handleSubmit = async () => {
    const user = getCurrentAppUser();
    if (!user || !active) return;
    if (!body.trim()) {
      Alert.alert(text('Write something', 'Magsulat'), text('Your post is empty.', 'Walang laman.'));
      return;
    }
    setBusy(true);
    try {
      if (props.replyTo) {
        await postReply({
          farmId: props.farmId,
          postId: props.replyTo.id,
          authorUid: user.uid,
          authorName: user.fullName || user.email,
          authorRole: active.role,
          body,
        });
        toast.ok('community', text('Reply posted', 'Naipost ang reply'));
      } else {
        await postAnnouncement({
          farmId: props.farmId,
          authorUid: user.uid,
          authorName: user.fullName || user.email,
          authorRole: active.role,
          body,
        });
        toast.ok('community', text('Announcement posted', 'Naipost'));
      }
      props.onClose();
    } catch (e) {
      const msg = normalizeCommunityError(e);
      toast.err('community', text('Could not post', 'Hindi maipost'), msg);
      Alert.alert(text('Could not post', 'Hindi maipost'), msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={props.visible} animationType="slide" transparent={false} onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, Spacing.lg) }]}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {props.replyTo ? text(`Reply to ${props.replyTo.authorName}`, `Reply kay ${props.replyTo.authorName}`) : text('New post', 'Bagong post')}
          </Text>
          <TouchableOpacity onPress={props.onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={text('Close', 'Isara')}>
            <MaterialCommunityIcons name="close" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={[styles.modalBody, { paddingBottom: Math.max(insets.bottom + Spacing.md, 24) }]}
          keyboardShouldPersistTaps="handled"
        >
          {props.replyTo && (
            <View style={styles.quotedPost}>
              <Text style={styles.quotedAuthor}>{props.replyTo.authorName}</Text>
              <Text style={styles.quotedBody} numberOfLines={3}>{props.replyTo.body}</Text>
            </View>
          )}
          <TextInput
            style={styles.composer}
            value={body}
            onChangeText={setBody}
            placeholder={props.replyTo
              ? text('Write your reply…', 'Isulat ang reply…')
              : text('Share an update or ask the community.', 'Magbahagi o magtanong sa komunidad.')}
            placeholderTextColor={Colors.textTertiary}
            multiline
            autoFocus
          />
          <Button
            label={props.replyTo ? text('Send reply', 'Ipadala') : text('Post', 'Ipost')}
            icon="send"
            onPress={handleSubmit}
            loading={busy}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1, minWidth: 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: Spacing.xl },
  topBarWrap: { paddingBottom: 2 },

  header: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingVertical: Spacing.md,
  },
  headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  headerTitle: { ...Type.title, color: Colors.primaryDark },
  headerSub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  feed: { paddingTop: Spacing.md, gap: Spacing.md },
  feedLoader: { marginTop: Spacing.xl },

  postCard: { gap: Spacing.sm },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  avatarSmall: { width: 28, height: 28, borderRadius: 14 },
  avatarText: { color: Colors.textOnPrimary, fontWeight: '800', fontSize: 14 },
  postAuthor: { ...Type.bodyStrong, color: Colors.textPrimary },
  postMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  postTime: { ...Type.caption, color: Colors.textTertiary },
  postBody: { ...Type.body, color: Colors.textPrimary },
  postActions: {
    flexDirection: 'row',
    gap: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs },
  actionText: { ...Type.caption, fontWeight: '700', color: Colors.primaryDark },
  repliesBox: { marginTop: Spacing.xs, paddingLeft: Spacing.sm, borderLeftWidth: 2, borderLeftColor: Colors.borderLight, gap: Spacing.md },
  noRepliesText: { ...Type.caption, color: Colors.textTertiary, fontStyle: 'italic' },
  replyRow: { flexDirection: 'row', gap: Spacing.sm },
  replyAuthor: { ...Type.caption, fontWeight: '700', color: Colors.textPrimary },
  replyTime: { ...Type.caption, fontWeight: '400', color: Colors.textTertiary },
  replyBody: { ...Type.caption, color: Colors.textPrimary, marginTop: 2 },
  replyActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: 4 },
  replyActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: { ...Type.h2, color: Colors.primaryDark, flex: 1 },
  modalBody: { padding: Spacing.lg, gap: Spacing.md, flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  quotedPost: { backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: Colors.primaryDark },
  quotedAuthor: { ...Type.caption, fontWeight: '700', color: Colors.primaryDark },
  quotedBody: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  composer: {
    minHeight: 180,
    maxHeight: 280,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Type.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    textAlignVertical: 'top',
  },
});
