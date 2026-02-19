/**
 * @fileoverview NeoOS — Contacts & Messaging App
 * Procedurally generated social feed + NPC instant messaging.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePhoneStore, type Contact } from '../../store/usePhoneStore';

const QUICK_REPLIES = [
    'OK', 'Compris', 'On se retrouve où ?', 'J\'arrive !', 'Pas maintenant', 'Parle à mon fixeur',
];

const NPC_AUTO_REPLIES: Record<string, string[]> = {
    npc_rex: ['Tu sais à qui tu parles ?', 'Intéressant...', 'Je t\'envoie les coords.', 'Arasaka surveille tout.'],
    npc_nyx: ['La route appelle 🌅', 'Garde tes crédits pour toi.', 'Je suis dans la Baie, viens.', 'Nomades toujours.'],
    npc_slash: ['jack in, jack out 😈', 'Firewall tombé. EZ.', 'T\'as un job pour moi ?', 'Encryp-tout.'],
    npc_mira: ['Je peux réparer ça.', 'Ça va coûter cher.', 'Viens à la clinique.', 'Pas de dette, pas de soin.'],
};

// ── Procedural Feed ───────────────────────────────────────────────────────────

const FEED_TEMPLATES = [
    (name: string) => `📸 Nouvelle photo depuis NeoCity Sector ${Math.floor(Math.random() * 9 + 1)} #Cybervie`,
    (name: string) => `🔥 ${name} vient de terminer une mission Tier ${Math.floor(Math.random() * 5 + 1)}`,
    (name: string) => `💬 "${['La rue prend tout.', 'Survie > honneur.', 'Corpo dehors !', 'Rêve en 4K, vis en 8-bit.'][Math.floor(Math.random() * 4)]}"`,
    (name: string) => `🏆 Classement: ${name} est #${Math.floor(Math.random() * 50 + 1)} des fixers ce mois-ci`,
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContactsApp() {
    const { contacts, sendMessage, receiveMessage, markRead } = usePhoneStore();
    const [tab, setTab] = useState<'feed' | 'messages'>('feed');
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [inputText, setInputText] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    const [feed] = useState(() => {
        const posts: { id: string; author: Contact; content: string; likes: number; liked: boolean; ts: number }[] = [];
        contacts.forEach((c) => {
            for (let i = 0; i < 3; i++) {
                posts.push({
                    id: `${c.id}-${i}`,
                    author: c,
                    content: FEED_TEMPLATES[Math.floor(Math.random() * FEED_TEMPLATES.length)](c.name),
                    likes: Math.floor(Math.random() * 980),
                    liked: false,
                    ts: Date.now() - Math.floor(Math.random() * 7200000),
                });
            }
        });
        return posts.sort((a, b) => b.ts - a.ts);
    });

    const [feedState, setFeedState] = useState(feed);

    const toggleLike = (id: string) =>
        setFeedState((f) => f.map((p) => p.id !== id ? p : { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }));

    // Auto-reply simulation
    const handleSend = () => {
        if (!inputText.trim() || !selectedContact) return;
        sendMessage(selectedContact.id, inputText.trim());
        setInputText('');
        const replies = NPC_AUTO_REPLIES[selectedContact.id] ?? ['...'];
        setTimeout(() => {
            receiveMessage(selectedContact.id, replies[Math.floor(Math.random() * replies.length)]);
        }, 800 + Math.random() * 1200);
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [selectedContact?.messages.length]);

    useEffect(() => {
        if (selectedContact) markRead(selectedContact.id);
    }, [selectedContact]);

    const refresh = () => usePhoneStore.getState().contacts.find(c => c.id === selectedContact?.id);
    const liveContact = selectedContact ? contacts.find(c => c.id === selectedContact.id) ?? selectedContact : null;

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', padding: '48px 16px 0', gap: '0', background: '#0d1117' }}>
                {(['feed', 'messages'] as const).map((t) => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        flex: 1, padding: '12px', border: 'none', cursor: 'pointer',
                        background: 'transparent',
                        color: tab === t ? '#00f5ff' : 'rgba(255,255,255,0.4)',
                        fontWeight: tab === t ? 700 : 400, fontSize: '14px',
                        borderBottom: tab === t ? '2px solid #00f5ff' : '2px solid transparent',
                        transition: 'all 0.2s',
                    }}>
                        {t === 'feed' ? '📰 Feed' : '💬 Messages'}
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                <AnimatePresence mode="popLayout">
                    {tab === 'feed' ? (
                        <motion.div key="feed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            {feedState.map((post) => (
                                <div key={post.id} style={{
                                    padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                }}>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{
                                            width: '36px', height: '36px', borderRadius: '50%',
                                            background: 'rgba(0,245,255,0.15)', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0,
                                        }}>
                                            {post.author.avatar}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{post.author.name}</div>
                                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{post.author.handle}</div>
                                        </div>
                                        <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                                            {Math.round((Date.now() - post.ts) / 60000)}min
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>{post.content}</div>
                                    <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                                        <button onClick={() => toggleLike(post.id)} style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            color: post.liked ? '#ff2d78' : 'rgba(255,255,255,0.4)', fontSize: '13px',
                                        }}>
                                            {post.liked ? '❤️' : '🤍'} {post.likes}
                                        </button>
                                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>💬 Share</span>
                                    </div>
                                </div>
                            ))}
                        </motion.div>
                    ) : (
                        <motion.div key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            {liveContact ? (
                                // Chat View
                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    <div style={{
                                        flex: 1, overflowY: 'auto', padding: '16px',
                                        display: 'flex', flexDirection: 'column', gap: '8px',
                                        maxHeight: 'calc(844px - 280px)',
                                    }}>
                                        {liveContact.messages.length === 0 && (
                                            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px', marginTop: '40px' }}>
                                                Commence la conversation...
                                            </div>
                                        )}
                                        {liveContact.messages.map((msg) => (
                                            <div key={msg.id} style={{
                                                display: 'flex',
                                                justifyContent: msg.sender === 'player' ? 'flex-end' : 'flex-start',
                                            }}>
                                                <div style={{
                                                    maxWidth: '72%', padding: '10px 14px', borderRadius: '18px',
                                                    background: msg.sender === 'player'
                                                        ? 'linear-gradient(135deg, #00f5ff33, #00f5ff11)'
                                                        : 'rgba(255,255,255,0.08)',
                                                    border: msg.sender === 'player'
                                                        ? '1px solid rgba(0,245,255,0.3)'
                                                        : '1px solid rgba(255,255,255,0.08)',
                                                    fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.4,
                                                }}>
                                                    {msg.text}
                                                </div>
                                            </div>
                                        ))}
                                        <div ref={bottomRef} />
                                    </div>
                                    {/* Quick Replies */}
                                    <div style={{ padding: '8px 12px', overflowX: 'auto', display: 'flex', gap: '8px', whiteSpace: 'nowrap' }}>
                                        {QUICK_REPLIES.map((r) => (
                                            <button key={r}
                                                onClick={() => { setInputText(r); }}
                                                style={{
                                                    padding: '6px 12px', borderRadius: '14px', flexShrink: 0,
                                                    background: 'rgba(0,245,255,0.08)', border: '1px solid rgba(0,245,255,0.2)',
                                                    color: '#00f5ff', fontSize: '12px', cursor: 'pointer',
                                                }}>
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Input */}
                                    <div style={{ display: 'flex', gap: '10px', padding: '8px 16px 16px' }}>
                                        <input
                                            value={inputText} onChange={(e) => setInputText(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                            placeholder="Message..."
                                            style={{
                                                flex: 1, padding: '12px 16px', borderRadius: '24px',
                                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                                                color: '#fff', fontSize: '14px', outline: 'none',
                                            }}
                                        />
                                        <button onClick={handleSend} style={{
                                            width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                                            background: '#00f5ff', color: '#000', fontSize: '18px', cursor: 'pointer',
                                        }}>›</button>
                                    </div>
                                </div>
                            ) : (
                                // Contact List
                                contacts.map((c) => (
                                    <div key={c.id}
                                        onClick={() => setSelectedContact(c)}
                                        style={{
                                            display: 'flex', gap: '12px', alignItems: 'center',
                                            padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{ position: 'relative' }}>
                                            <div style={{
                                                width: '48px', height: '48px', borderRadius: '50%',
                                                background: 'rgba(0,245,255,0.12)', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center', fontSize: '22px',
                                            }}>{c.avatar}</div>
                                            {c.online && (
                                                <div style={{
                                                    position: 'absolute', bottom: 1, right: 1,
                                                    width: '12px', height: '12px', borderRadius: '50%',
                                                    background: '#00ff88', border: '2px solid #0d1117',
                                                }} />
                                            )}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{c.name}</div>
                                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                                                {c.messages.at(-1)?.text.slice(0, 40) ?? c.handle}
                                            </div>
                                        </div>
                                        {c.unread > 0 && (
                                            <div style={{
                                                minWidth: '20px', height: '20px', borderRadius: '10px',
                                                background: '#00f5ff', color: '#000', fontSize: '11px',
                                                fontWeight: 700, display: 'flex', alignItems: 'center',
                                                justifyContent: 'center', padding: '0 6px',
                                            }}>{c.unread}</div>
                                        )}
                                    </div>
                                ))
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
