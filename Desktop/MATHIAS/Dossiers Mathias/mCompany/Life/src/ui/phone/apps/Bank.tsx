/**
 * @fileoverview NeoOS — Bank App
 * Crypto charts (Recharts), transaction history, P2P transfer modal.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import { usePhoneStore, type CryptoTick } from '../../store/usePhoneStore';

const ACCENT = '#00ff88';

// ── Crypto Simulator ──────────────────────────────────────────────────────────

function seedTick(): CryptoTick {
    return {
        time: Date.now(),
        BTC: 45000 + Math.random() * 5000,
        ETH: 2800 + Math.random() * 400,
        NC: 1.00 + Math.random() * 0.3,
    };
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function CryptoTooltip({ active, payload }: { active?: boolean; payload?: { value: number; name: string }[] }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'rgba(10,12,18,0.95)', border: '1px solid rgba(0,255,136,0.3)',
            borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#fff',
        }}>
            <div style={{ color: ACCENT, fontWeight: 700 }}>{payload[0].name}</div>
            <div>${payload[0].value.toFixed(2)}</div>
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankApp() {
    const { balance, transactions, cryptoTicks, pushCryptoTick, addTransaction } = usePhoneStore();
    const [activeCrypto, setActiveCrypto] = useState<'BTC' | 'ETH' | 'NC'>('BTC');
    const [showTransfer, setShowTransfer] = useState(false);
    const [transferTo, setTransferTo] = useState('');
    const [transferAmt, setTransferAmt] = useState('');

    // Seed initial ticks + live updates
    useEffect(() => {
        const initial = Array.from({ length: 30 }, (_, i) => ({
            time: Date.now() - (30 - i) * 2000,
            BTC: 45000 + Math.sin(i * 0.5) * 2000 + Math.random() * 500,
            ETH: 2800 + Math.sin(i * 0.3) * 200 + Math.random() * 50,
            NC: 1.00 + Math.sin(i * 0.8) * 0.15 + Math.random() * 0.02,
        }));
        initial.forEach(pushCryptoTick);

        const interval = setInterval(() => pushCryptoTick(seedTick()), 2000);
        return () => clearInterval(interval);
    }, [pushCryptoTick]);

    const chartData = cryptoTicks.map((t, i) => ({
        t: i,
        BTC: +t.BTC.toFixed(2),
        ETH: +t.ETH.toFixed(2),
        NC: +t.NC.toFixed(4),
    }));

    const latest = cryptoTicks.at(-1);
    const prior = cryptoTicks.at(-6);
    const delta = latest && prior ? latest[activeCrypto] - prior[activeCrypto] : 0;
    const pct = prior ? (delta / prior[activeCrypto]) * 100 : 0;
    const isUp = delta >= 0;

    const handleTransfer = () => {
        const amount = parseFloat(transferAmt);
        if (!transferTo || isNaN(amount) || amount <= 0) return;
        addTransaction({ type: 'debit', amount, currency: 'NC', description: `Virement → ${transferTo}`, counterpart: transferTo });
        setShowTransfer(false);
        setTransferTo(''); setTransferAmt('');
    };

    return (
        <div style={{ height: '100%', overflowY: 'auto', padding: '48px 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Balance Header */}
            <div style={{ textAlign: 'center', padding: '0 0 8px' }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', letterSpacing: '2px', textTransform: 'uppercase' }}>Solde total</div>
                <div style={{ fontSize: '42px', fontWeight: 700, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>
                    {balance.toLocaleString('fr-FR')} <span style={{ fontSize: '20px', color: ACCENT }}>NC</span>
                </div>
            </div>

            {/* Crypto Tabs */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {(['BTC', 'ETH', 'NC'] as const).map((c) => (
                    <button
                        key={c}
                        onClick={() => setActiveCrypto(c)}
                        style={{
                            padding: '6px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                            background: activeCrypto === c ? ACCENT : 'rgba(255,255,255,0.08)',
                            color: activeCrypto === c ? '#000' : 'rgba(255,255,255,0.7)',
                            fontWeight: 600, fontSize: '13px', transition: 'all 0.2s',
                        }}
                    >{c}</button>
                ))}
            </div>

            {/* Chart */}
            <div style={{ background: 'rgba(0,255,136,0.04)', borderRadius: '16px', padding: '12px', border: '1px solid rgba(0,255,136,0.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{activeCrypto}</span>
                    <span style={{ fontSize: '14px', color: isUp ? ACCENT : '#ff4444', fontWeight: 600 }}>
                        {isUp ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
                    </span>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="cryptoGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isUp ? ACCENT : '#ff4444'} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={isUp ? ACCENT : '#ff4444'} stopOpacity={0.0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="t" hide />
                        <YAxis domain={['auto', 'auto']} hide />
                        <Tooltip content={<CryptoTooltip />} />
                        <Area
                            type="monotone" dataKey={activeCrypto}
                            stroke={isUp ? ACCENT : '#ff4444'} strokeWidth={2}
                            fill="url(#cryptoGrad)" dot={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Transfer Button */}
            <button
                onClick={() => setShowTransfer(true)}
                style={{
                    padding: '14px', borderRadius: '16px', cursor: 'pointer',
                    background: `linear-gradient(135deg, ${ACCENT}33, ${ACCENT}11)`,
                    color: ACCENT, fontWeight: 700, fontSize: '15px',
                    border: `1px solid ${ACCENT}44`, width: '100%',
                }}
            >
                💸 Virement P2P
            </button>

            {/* Transaction History */}
            <div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>Historique</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {transactions.map((tx) => (
                        <div key={tx.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '12px 14px', borderRadius: '12px',
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div>
                                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{tx.description}</div>
                                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
                                    {new Date(tx.timestamp).toLocaleDateString('fr-FR')}
                                </div>
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: tx.type === 'credit' ? ACCENT : '#ff4444' }}>
                                {tx.type === 'credit' ? '+' : '-'}{tx.amount.toLocaleString()} {tx.currency}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Transfer Modal */}
            <AnimatePresence>
                {showTransfer && (
                    <motion.div
                        className="absolute inset-0 flex items-end"
                        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setShowTransfer(false)}
                    >
                        <motion.div
                            style={{ width: '100%', background: '#12151f', borderRadius: '24px 24px 0 0', padding: '24px' }}
                            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Virement P2P</div>
                            <input
                                placeholder="Destinataire (@pseudo)"
                                value={transferTo} onChange={(e) => setTransferTo(e.target.value)}
                                style={inputStyle}
                            />
                            <input
                                placeholder="Montant (NC)"
                                type="number" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)}
                                style={{ ...inputStyle, marginTop: '10px' }}
                            />
                            <button onClick={handleTransfer} style={{
                                marginTop: '14px', width: '100%', padding: '14px', borderRadius: '14px',
                                background: ACCENT, color: '#000', fontWeight: 700, fontSize: '15px',
                                border: 'none', cursor: 'pointer',
                            }}>
                                Envoyer
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: '12px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', fontSize: '14px', outline: 'none',
};
