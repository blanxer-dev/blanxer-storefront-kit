'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { checkPayment } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { formatTimeLeft, usePaymentHold, type HoldData } from './payment-hold.js';
import { Button, Modal, cx } from './ui.js';

/** Shown when the shopper taps ✕ on a live QR: closing gives the items back to other shoppers. */
export function PaymentCloseConfirm({ loading, onCheck, onConfirm, onBack }: { loading: boolean; onCheck: () => void; onConfirm: () => void; onBack: () => void }) {
  return (
    <div className="bx-close-confirm">
      <p className="bx-close-confirm-title">Cancel this payment?</p>
      <p className="bx-muted">
        If you have already paid in your banking app or wallet, don&apos;t cancel. Tap <strong>Check payment</strong> and wait a
        moment. Cancelling releases your items to other shoppers.
      </p>
      <Button loading={loading} onClick={onCheck}>
        Check payment
      </Button>
      <Button variant="secondary" onClick={onBack}>
        Back to QR
      </Button>
      <Button variant="ghost" className="bx-danger-text" onClick={onConfirm}>
        Yes, cancel payment
      </Button>
    </div>
  );
}

function Expired({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="bx-qr-expired">
      <p className="bx-qr-expired-title">QR is expired</p>
      <p className="bx-muted">Your items were released so other shoppers can buy them. If you already paid, your order is still confirmed.</p>
      <Button onClick={onClose}>Back to checkout</Button>
      <Button variant="ghost" onClick={() => router.push('/')}>
        Go to home
      </Button>
    </div>
  );
}

function Timer({ timeLeft }: { timeLeft: number }) {
  return (
    <p className="bx-qr-timer">
      QR will expire in <strong className={cx(timeLeft <= 60 && 'bx-danger-text')}>{formatTimeLeft(timeLeft)}</strong>
    </p>
  );
}

export interface QrPaymentData extends HoldData {
  qr_message: string;
  amount: number;
}

/**
 * Blanxer QR / Fonepay QR modal: QR + amount + countdown from `hold_seconds`,
 * automatic check every 5 s and on tab return, confirm-before-close, hold
 * release on cancel or expiry. On payment: `onSuccess()` then `/payment/success`.
 */
export function QrPaymentModal({ open, data, onClose, onSuccess }: { open: boolean; data: QrPaymentData | null; onClose: () => void; onSuccess?: () => void }) {
  const { notify } = useBlanxer();
  const money = useMoney();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const paidRef = useRef(false);

  useEffect(() => {
    paidRef.current = false;
    setConfirmClose(false);
  }, [data?.transaction]);

  const onPaid = () => {
    if (paidRef.current) return;
    paidRef.current = true;
    notify({ type: 'success', title: 'Success', message: 'Payment Received' });
    onSuccess?.();
    router.push('/payment/success');
    onClose();
  };

  const isPaid = () => checkPayment('qr', data?.transaction || '');

  const { timeLeft, expired, release, settledRef } = usePaymentHold({
    open,
    data,
    checkEverySeconds: 5,
    check: async () => {
      const ok = await isPaid();
      if (ok) onPaid();
      return ok;
    },
  });

  const manualCheck = async () => {
    if (settledRef.current) return;
    setLoading(true);
    if (await isPaid()) {
      settledRef.current = true;
      onPaid();
    } else {
      notify({ type: 'error', title: 'Error', message: 'Payment has not been received yet.' });
    }
    setLoading(false);
  };

  const requestClose = () => {
    if (expired || settledRef.current) {
      setConfirmClose(false);
      onClose();
    } else setConfirmClose(true);
  };

  const cancelPayment = async () => {
    setConfirmClose(false);
    await release();
    onClose();
  };

  return (
    <Modal open={open} onClose={requestClose} title="Scan to pay" className="bx-qr-modal">
      {confirmClose && !expired ? (
        <PaymentCloseConfirm loading={loading} onCheck={manualCheck} onConfirm={cancelPayment} onBack={() => setConfirmClose(false)} />
      ) : expired ? (
        <Expired onClose={onClose} />
      ) : (
        <div className="bx-qr">
          <div className="bx-qr-code">
            <QRCode value={data?.qr_message || ''} size={220} />
          </div>
          <p className="bx-qr-amount">{money(Number(data?.amount) || 0)}</p>
          <Timer timeLeft={timeLeft} />
          <p className="bx-qr-steps-title">Steps to complete payment:</p>
          <ol className="bx-qr-steps">
            <li>Scan / Screenshot this QR</li>
            <li>Open any wallet / mobile banking App</li>
            <li>Complete the payment</li>
            <li>Keep this page open — we confirm it automatically</li>
          </ol>
          <Button loading={loading} onClick={manualCheck}>
            Check Payment
          </Button>
        </div>
      )}
    </Modal>
  );
}

export interface FonepayBank {
  bankName: string;
  bankCode: string;
  bankIcon: string;
  packageName: string;
  intentScheme: string;
}

export interface FonepayCheckoutData extends HoldData {
  prn: string;
  qr_message: string;
  socket_url: string;
  amount: number;
  banks?: FonepayBank[];
}

const useIsMobile = () => {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
};

/**
 * "Checkout by Fonepay": desktop → QR; mobile → bank list that deep-links into
 * the banking app (with "Scan QR instead"). Fonepay's websocket reports success
 * in real time; the payment is always re-confirmed against Blanxer (also every
 * 10 s and on tab return). Same hold timer / release rules as the QR modal.
 */
export function FonepayCheckoutModal({ open, data, onClose, onSuccess }: { open: boolean; data: FonepayCheckoutData | null; onClose: () => void; onSuccess?: () => void }) {
  const { notify } = useBlanxer();
  const money = useMoney();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [search, setSearch] = useState('');
  const [appNotFound, setAppNotFound] = useState<FonepayBank | null>(null);
  const [showQr, setShowQr] = useState(false);
  const settledRef = useRef(false);

  const banks = data?.banks || [];
  const showBankList = isMobile && banks.length > 0;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? banks.filter((b) => b.bankName?.toLowerCase().includes(q)) : banks;
  }, [banks, search]);

  const confirmPayment = async (showError: boolean) => {
    if (settledRef.current) return;
    setLoading(true);
    const ok = await checkPayment('fonepay_checkout', data?.transaction || '');
    if (ok) {
      settledRef.current = true;
      notify({ type: 'success', title: 'Success', message: 'Payment Received' });
      onSuccess?.();
      router.push('/payment/success');
      onClose();
    } else if (showError) {
      notify({ type: 'error', title: 'Error', message: 'Payment has not been received yet.' });
    }
    setLoading(false);
  };

  useEffect(() => {
    settledRef.current = false;
    setConfirmClose(false);
    setShowQr(false);
    setAppNotFound(null);
  }, [data?.transaction]);

  const { timeLeft, expired, release } = usePaymentHold({
    open,
    data,
    checkEverySeconds: 10,
    check: async () => {
      await confirmPayment(false);
      return settledRef.current;
    },
  });

  const requestClose = () => {
    if (expired || settledRef.current) {
      setConfirmClose(false);
      onClose();
    } else setConfirmClose(true);
  };

  const cancelPayment = async () => {
    setConfirmClose(false);
    await release();
    onClose();
  };

  // Real-time success from Fonepay's websocket.
  useEffect(() => {
    if (!open || !data?.socket_url || typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(data.socket_url);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (!msg?.transactionStatus) return;
          const txn = JSON.parse(msg.transactionStatus);
          if (txn.productNumber == data?.prn && !!txn.paymentSuccess) confirmPayment(false);
        } catch {
          /* ignore malformed frames */
        }
      };
    } catch {
      ws = null;
    }
    return () => ws?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data?.socket_url]);

  const openBankApp = (bank: FonepayBank) => {
    const payload = data?.qr_message || '';
    if (!bank?.intentScheme || !payload) return;
    let launched = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') launched = true;
    };
    document.addEventListener('visibilitychange', onHide);
    window.location.href = `${bank.intentScheme}/?qrPayload=${encodeURIComponent(payload)}`;
    window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!launched && document.visibilityState === 'visible') setAppNotFound(bank);
    }, 2000);
  };

  return (
    <Modal open={open} onClose={requestClose} title="Checkout by Fonepay" className="bx-qr-modal bx-fonepay-modal">
      {confirmClose && !expired ? (
        <PaymentCloseConfirm loading={loading} onCheck={() => confirmPayment(true)} onConfirm={cancelPayment} onBack={() => setConfirmClose(false)} />
      ) : expired ? (
        <Expired onClose={onClose} />
      ) : showBankList && !showQr ? (
        <div className="bx-banks">
          <p className="bx-banks-title">Select your bank or wallet</p>
          <input className="bx-input" placeholder="Search..." aria-label="Search banks" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="bx-bank-list">
            {filtered.map((bank) => (
              <button key={bank.bankCode} type="button" className="bx-bank" onClick={() => openBankApp(bank)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- bank logos come from Fonepay */}
                <img src={bank.bankIcon} alt="" width={32} height={32} loading="lazy" />
                <span>{bank.bankName}</span>
              </button>
            ))}
            {!filtered.length ? <p className="bx-muted">No banks found</p> : null}
          </div>
          <Timer timeLeft={timeLeft} />
          <Button variant="secondary" onClick={() => setShowQr(true)}>
            Scan QR Code Instead
          </Button>
          <Button loading={loading} onClick={() => confirmPayment(true)}>
            Check Status
          </Button>
          {appNotFound ? (
            <div className="bx-app-not-found">
              <p className="bx-strong">Mobile banking App not found</p>
              <p className="bx-muted">The selected mobile banking service or digital wallet is currently unavailable.</p>
              <Button variant="secondary" onClick={() => setAppNotFound(null)}>
                Try Again
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="bx-qr">
          {showQr ? (
            <Button variant="ghost" onClick={() => setShowQr(false)}>
              ← Back to bank list
            </Button>
          ) : null}
          <p className="bx-muted">
            Use your <strong>Mobile Banking or Wallets App</strong> to scan
          </p>
          <div className="bx-qr-code">
            <QRCode value={data?.qr_message || ''} size={220} />
          </div>
          <p className="bx-qr-amount">{money(Number(data?.amount) || 0)}</p>
          <Timer timeLeft={timeLeft} />
          <p className="bx-qr-steps-title">How to pay using this QR code:</p>
          <ol className="bx-qr-steps">
            <li>Open your mobile banking app or digital wallet</li>
            <li>Scan the QR code</li>
            <li>Verify the payment details</li>
            <li>Tap Confirm to complete your payment</li>
          </ol>
          <Button loading={loading} onClick={() => confirmPayment(true)}>
            Check Status
          </Button>
        </div>
      )}
    </Modal>
  );
}
