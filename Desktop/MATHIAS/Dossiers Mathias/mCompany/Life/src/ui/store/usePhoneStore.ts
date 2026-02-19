/**
 * @fileoverview LIFE RPG — Phone OS Store (Zustand)
 *
 * Application-level state for all NeoOS apps:
 * contacts, social feed, transactions, missions, gallery, music.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Shared Types ──────────────────────────────────────────────────────────────

export type ContactId = string;
export type MissionId = string;

// ── Contacts & Messaging ──────────────────────────────────────────────────────

export interface Contact {
    id: ContactId;
    name: string;
    handle: string;
    avatar: string; // emoji or initials
    faction: string;
    messages: ChatMessage[];
    unread: number;
    online: boolean;
}

export interface ChatMessage {
    id: string;
    sender: 'player' | ContactId;
    text: string;
    timestamp: number;
}

// ── Social Feed ───────────────────────────────────────────────────────────────

export interface SocialPost {
    id: string;
    authorId: ContactId;
    content: string;
    likes: number;
    liked: boolean;
    timestamp: number;
}

// ── Bank ──────────────────────────────────────────────────────────────────────

export interface Transaction {
    id: string;
    type: 'credit' | 'debit';
    amount: number;
    currency: 'NC' | 'BTC' | 'ETH'; // NeoCredits + cryptos
    description: string;
    timestamp: number;
    counterpart?: string;
}

export interface CryptoTick {
    time: number;
    BTC: number;
    ETH: number;
    NC: number;
}

// ── Missions / Kanban ─────────────────────────────────────────────────────────

export type MissionStatus = 'todo' | 'inProgress' | 'done';

export interface Mission {
    id: MissionId;
    title: string;
    description: string;
    status: MissionStatus;
    priority: 'low' | 'medium' | 'high' | 'critical';
    reward: number;
    faction: string;
    startTime?: number;
    deadline?: number;
    timerRunning: boolean;
    elapsed: number; // seconds
}

// ── Gallery ───────────────────────────────────────────────────────────────────

export interface GalleryPhoto {
    id: string;
    dataUrl: string;  // base64 PNG from WebGLRenderTarget
    filter: string;
    capturedAt: number;
}

// ── Music ─────────────────────────────────────────────────────────────────────

export interface Track {
    id: string;
    title: string;
    artist: string;
    duration: number; // seconds
    src: string;
}

export type RadioStation = 'NeoWave FM' | 'CyberBeat Radio' | 'Underground Static' | 'Silence';

// ── State Interface ───────────────────────────────────────────────────────────

export interface PhoneState {
    // Contacts
    contacts: Contact[];

    // Social Feed
    feed: SocialPost[];

    // Bank
    balance: number;
    transactions: Transaction[];
    cryptoTicks: CryptoTick[];

    // Missions
    missions: Mission[];

    // Gallery
    gallery: GalleryPhoto[];

    // Music
    tracks: Track[];
    currentTrackIndex: number;
    isPlaying: boolean;
    radioStation: RadioStation;
    volume: number;

    // Actions — Contacts
    sendMessage: (contactId: ContactId, text: string) => void;
    receiveMessage: (contactId: ContactId, text: string) => void;
    markRead: (contactId: ContactId) => void;

    // Actions — Social
    toggleLike: (postId: string) => void;

    // Actions — Bank
    addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => void;
    pushCryptoTick: (tick: CryptoTick) => void;

    // Actions — Missions
    moveMission: (id: MissionId, status: MissionStatus) => void;
    tickMissionTimer: (id: MissionId) => void;

    // Actions — Gallery
    addPhoto: (photo: Omit<GalleryPhoto, 'id' | 'capturedAt'>) => void;
    deletePhoto: (id: string) => void;

    // Actions — Music
    playPause: () => void;
    nextTrack: () => void;
    prevTrack: () => void;
    setRadioStation: (station: RadioStation) => void;
    setVolume: (v: number) => void;
}

// ── Seed Data ─────────────────────────────────────────────────────────────────

const seedContacts: Contact[] = [
    { id: 'npc_rex', name: 'Rex Nakamura', handle: '@rex_corp', avatar: '🦾', faction: 'Arasaka', messages: [], unread: 2, online: true },
    { id: 'npc_nyx', name: 'Nyxara', handle: '@nyx_void', avatar: '🌸', faction: 'Nomads', messages: [], unread: 0, online: false },
    { id: 'npc_slash', name: 'Slash', handle: '@sl4sh_3r', avatar: '⚡', faction: 'Netrunners', messages: [], unread: 1, online: true },
    { id: 'npc_mira', name: 'Dr. Mira', handle: '@med_mira', avatar: '💊', faction: 'StreetDoc', messages: [], unread: 0, online: true },
];

const seedMissions: Mission[] = [
    { id: 'm1', title: 'Récupérer le Shard', description: 'Vol d\'un data-shard Arasaka dans le quartier Nexus.', status: 'todo', priority: 'high', reward: 5000, faction: 'Netrunners', timerRunning: false, elapsed: 0 },
    { id: 'm2', title: 'Livraison médicaments', description: 'Livrer médicaments de synthèse au Doc de Street Level 7.', status: 'inProgress', priority: 'medium', reward: 1200, faction: 'StreetDoc', timerRunning: true, elapsed: 342 },
    { id: 'm3', title: 'Infiltration Corpo Tour', description: 'S\'introduire au siège de MegaCorp sans laisser de trace.', status: 'todo', priority: 'critical', reward: 15000, faction: 'Nomads', timerRunning: false, elapsed: 0 },
    { id: 'm4', title: 'Escorte VIP', description: 'Escorter le fixer Razor jusqu\'à la zone franche.', status: 'done', priority: 'low', reward: 800, faction: 'Fixers', timerRunning: false, elapsed: 1200 },
];

const seedTracks: Track[] = [
    { id: 't1', title: 'Neon Rain', artist: 'Synthex', duration: 247, src: '' },
    { id: 't2', title: 'Ghost Protocol', artist: 'Cyb3rwave', duration: 198, src: '' },
    { id: 't3', title: 'Void Walker', artist: 'NeoCortex', duration: 312, src: '' },
    { id: 't4', title: 'Chromatic Static', artist: 'Glitch//Art', duration: 183, src: '' },
];

// ── Store ─────────────────────────────────────────────────────────────────────

let msgId = 0;
let txId = 0;
let photoId = 0;

export const usePhoneStore = create<PhoneState>()(
    persist(
        (set, get) => ({
            contacts: seedContacts,
            feed: [],
            balance: 12_450,
            transactions: [
                { id: 'tx1', type: 'credit', amount: 5000, currency: 'NC', description: 'Mission: Exfil Nomade', timestamp: Date.now() - 86400000 },
                { id: 'tx2', type: 'debit', amount: 340, currency: 'NC', description: 'Implant Subdermal', timestamp: Date.now() - 43200000 },
                { id: 'tx3', type: 'credit', amount: 1200, currency: 'NC', description: 'Vente: Shard contraband', timestamp: Date.now() - 7200000 },
            ],
            cryptoTicks: [],
            missions: seedMissions,
            gallery: [],
            tracks: seedTracks,
            currentTrackIndex: 0,
            isPlaying: false,
            radioStation: 'NeoWave FM',
            volume: 0.7,

            sendMessage: (contactId, text) => set((state) => ({
                contacts: state.contacts.map((c) =>
                    c.id !== contactId ? c : {
                        ...c,
                        messages: [...c.messages, { id: `msg-${++msgId}`, sender: 'player', text, timestamp: Date.now() }],
                    }
                ),
            })),

            receiveMessage: (contactId, text) => set((state) => ({
                contacts: state.contacts.map((c) =>
                    c.id !== contactId ? c : {
                        ...c,
                        unread: c.unread + 1,
                        messages: [...c.messages, { id: `msg-${++msgId}`, sender: contactId, text, timestamp: Date.now() }],
                    }
                ),
            })),

            markRead: (contactId) => set((state) => ({
                contacts: state.contacts.map((c) => c.id !== contactId ? c : { ...c, unread: 0 }),
            })),

            toggleLike: (postId) => set((state) => ({
                feed: state.feed.map((p) =>
                    p.id !== postId ? p : {
                        ...p,
                        liked: !p.liked,
                        likes: p.liked ? p.likes - 1 : p.likes + 1,
                    }
                ),
            })),

            addTransaction: (tx) => set((state) => {
                const full: Transaction = { ...tx, id: `tx-${++txId}`, timestamp: Date.now() };
                const delta = tx.type === 'credit' ? tx.amount : -tx.amount;
                return {
                    balance: state.balance + delta,
                    transactions: [full, ...state.transactions].slice(0, 100),
                };
            }),

            pushCryptoTick: (tick) => set((state) => ({
                cryptoTicks: [...state.cryptoTicks, tick].slice(-60), // keep 60 ticks
            })),

            moveMission: (id, status) => set((state) => ({
                missions: state.missions.map((m) =>
                    m.id !== id ? m : {
                        ...m,
                        status,
                        timerRunning: status === 'inProgress',
                        startTime: status === 'inProgress' ? Date.now() : m.startTime,
                    }
                ),
            })),

            tickMissionTimer: (id) => set((state) => ({
                missions: state.missions.map((m) =>
                    m.id !== id || !m.timerRunning ? m : { ...m, elapsed: m.elapsed + 1 }
                ),
            })),

            addPhoto: (photo) => set((state) => ({
                gallery: [
                    { ...photo, id: `photo-${++photoId}`, capturedAt: Date.now() },
                    ...state.gallery,
                ].slice(0, 48),
            })),

            deletePhoto: (id) => set((state) => ({
                gallery: state.gallery.filter((p) => p.id !== id),
            })),

            playPause: () => set((state) => ({ isPlaying: !state.isPlaying })),

            nextTrack: () => set((state) => ({
                currentTrackIndex: (state.currentTrackIndex + 1) % state.tracks.length,
                isPlaying: true,
            })),

            prevTrack: () => set((state) => ({
                currentTrackIndex: (state.currentTrackIndex - 1 + state.tracks.length) % state.tracks.length,
                isPlaying: true,
            })),

            setRadioStation: (station) => set({ radioStation: station }),
            setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
        }),
        { name: 'life-phone' }
    )
);
