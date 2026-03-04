// Agency Settings page — four-tab professional settings UI for agency-role users:
//   Agency Profile, Billing, API Keys, and Sync Center.
// API key fields are masked by default with reveal/copy controls.
// Sync Center tab renders the SyncCenter component for Expert Mode (Method B) POS sync.
// All form fields are controlled inputs; the Save button shows brief visual feedback.
// (에이전시 설정 페이지 — 에이전시 역할 사용자를 위한 네 탭의 전문 설정 UI:
//  에이전시 프로필, 결제, API 키, 동기화 센터.
//  API 키 필드는 기본적으로 마스킹되며 공개/복사 컨트롤 제공.
//  동기화 센터 탭은 전문가 모드(방법 B) POS 동기화를 위한 SyncCenter 컴포넌트 렌더링.
//  모든 폼 필드는 제어 입력; 저장 버튼은 짧은 시각적 피드백 표시)

'use client';

import { useState } from 'react';
import {
  Building2,
  CreditCard,
  Key,
  Save,
  CheckCircle2,
  Phone,
  Mail,
  Globe,
  Eye,
  EyeOff,
  Copy,
  Check,
  Zap,
  CalendarDays,
  TrendingUp,
  RefreshCw,
}                   from 'lucide-react';
import { SyncCenter } from '@/modules/settings/components/SyncCenter';

// Tab identifier type — includes the Sync Center tab (탭 식별자 타입 — 동기화 센터 탭 포함)
type Tab = 'profile' | 'billing' | 'api-keys' | 'sync';

// ── Reusable text input with icon (아이콘이 있는 재사용 가능한 텍스트 입력) ──
function Field({
  label,
  value,
  onChange,
  icon: Icon,
  type = 'text',
  placeholder = '',
  readOnly = false,
}: {
  label:       string;
  value:       string;
  onChange?:   (v: string) => void;
  icon:        React.ComponentType<{ className?: string }>;
  type?:       string;
  placeholder?: string;
  readOnly?:   boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type={type}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg border py-2.5 pl-9 pr-4 text-sm shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500/20
            ${readOnly
              ? 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400'
              : 'border-gray-300 bg-white text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500'
            }`}
        />
      </div>
    </div>
  );
}

// ── Masked API key row with reveal and copy controls
//    (공개 및 복사 컨트롤이 있는 마스킹된 API 키 행) ──
function ApiKeyRow({ label, keyValue }: { label: string; keyValue: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied,   setCopied  ] = useState(false);

  // Copy key to clipboard and show brief confirmation (키를 클립보드에 복사 후 짧은 확인 표시)
  function handleCopy() {
    navigator.clipboard.writeText(keyValue).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const displayValue = revealed ? keyValue : '••••••••••••••••••••••••••••••••';

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <div className="flex gap-2">
        {/* Masked / revealed key field (마스킹/공개 키 필드) */}
        <div className="relative flex-1">
          <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            readOnly
            type="text"
            value={displayValue}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 font-mono text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
          />
        </div>

        {/* Reveal / hide toggle button (공개/숨기기 토글 버튼) */}
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          title={revealed ? 'Hide key' : 'Reveal key'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>

        {/* Copy to clipboard button (클립보드 복사 버튼) */}
        <button
          type="button"
          onClick={handleCopy}
          title="Copy to clipboard"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {copied
            ? <Check className="h-4 w-4 text-green-500" />
            : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencySettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [saved,     setSaved    ] = useState(false);

  // Agency Profile tab state (에이전시 프로필 탭 상태)
  const [agencyName,  setAgencyName ] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [website,     setWebsite    ] = useState('');

  // Show "Saved!" confirmation for 2.5 s then reset (2.5초 후 초기화되는 "저장됨!" 확인 표시)
  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Tab configuration — Sync Center is the fourth tab (탭 구성 — 동기화 센터는 네 번째 탭)
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'profile',  label: 'Agency Profile', icon: Building2  },
    { id: 'billing',  label: 'Billing',         icon: CreditCard },
    { id: 'api-keys', label: 'API Keys',         icon: Key        },
    { id: 'sync',     label: 'Sync Center',     icon: RefreshCw  },
  ];

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your agency profile, billing plan, and third-party API credentials.
        </p>
      </div>

      {/* Settings card (설정 카드) */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

        {/* Tab bar — horizontally scrollable on mobile, invisible scrollbar (모바일 가로 스크롤 탭 바 — 스크롤바 숨김) */}
        <div className="no-scrollbar flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-800">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-medium transition-colors focus:outline-none
                ${activeTab === id
                  ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content (탭 콘텐츠) */}
        <div className="p-6">

          {/* ── Agency Profile tab (에이전시 프로필 탭) ─────────────────────── */}
          {activeTab === 'profile' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Contact information and branding for your agency account.
              </p>

              {/* Agency avatar with initial (이니셜이 있는 에이전시 아바타) */}
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-bold text-white shadow-md ring-4 ring-indigo-100 dark:ring-indigo-900/30">
                  {agencyName.charAt(0).toUpperCase() || 'A'}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {agencyName || 'Your Agency'}
                  </p>
                  <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                    Agency
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Agency Name"    value={agencyName}    onChange={setAgencyName}    icon={Building2} placeholder="e.g. JM Restaurant Group" />
                <Field label="Contact Email"  value={contactEmail}  onChange={setContactEmail}  icon={Mail}      placeholder="admin@agency.com" type="email" />
                <Field label="Contact Phone"  value={contactPhone}  onChange={setContactPhone}  icon={Phone}     placeholder="+1 (555) 000-0000" />
                <Field label="Website"        value={website}       onChange={setWebsite}       icon={Globe}     placeholder="https://agency.com" />
              </div>
            </div>
          )}

          {/* ── Billing tab (결제 탭) ──────────────────────────────────────── */}
          {activeTab === 'billing' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Subscription plan, usage, and payment method for this agency account.
              </p>

              {/* Current plan card (현재 플랜 카드) */}
              <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/40 dark:bg-indigo-900/20">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <p className="text-sm font-bold text-indigo-900 dark:text-indigo-100">Pro Plan</p>
                    <p className="text-xs text-indigo-700 dark:text-indigo-400">
                      Unlimited stores · Priority support · All modules
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-bold text-white shadow-sm">
                  Active
                </span>
              </div>

              {/* Billing summary grid (결제 요약 그리드) */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

                {/* Next billing date (다음 결제 날짜) */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <CalendarDays className="h-3.5 w-3.5" /> Next Billing
                  </div>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100">03/27/2026</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">$299.00 / month</p>
                </div>

                {/* AI calls this month (이번 달 AI 통화 수) */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <TrendingUp className="h-3.5 w-3.5" /> AI Calls (Feb)
                  </div>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100">1,847</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: '74%' }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">74% of 2,500 limit</p>
                </div>

                {/* Active stores (활성 매장 수) */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Building2 className="h-3.5 w-3.5" /> Active Stores
                  </div>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100">4</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Unlimited on Pro</p>
                </div>
              </div>

              {/* Payment method display (결제 수단 표시) */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Payment Method
                </p>
                <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/40">
                  <CreditCard className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Visa ending in 4242
                  </span>
                  <span className="ml-auto text-xs text-gray-400">Expires 08/28</span>
                  <button className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                    Update
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── API Keys tab (API 키 탭) ───────────────────────────────────── */}
          {activeTab === 'api-keys' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Third-party API credentials used by the JM AI Voice platform. Keep these secret.
              </p>

              {/* Warning banner (경고 배너) */}
              <div className="flex items-start gap-2.5 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 dark:border-yellow-900/40 dark:bg-yellow-900/10">
                <Key className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
                  Never share these keys publicly. Rotate them immediately if you suspect a breach.
                </p>
              </div>

              <div className="space-y-4">
                {/* Gemini API Key (Gemini API 키) */}
                <ApiKeyRow
                  label="Google Gemini API Key"
                  keyValue="AIzaSy••••••••••••••••••••••••••••••••Xk9s"
                />

                {/* Retell API Key (Retell API 키) */}
                <ApiKeyRow
                  label="Retell AI API Key"
                  keyValue="key_live_••••••••••••••••••••••••••••••••••••••••••••••••••••sk"
                />

                {/* Supabase URL (Supabase URL) */}
                <ApiKeyRow
                  label="Supabase Project URL"
                  keyValue="https://••••••••••••.supabase.co"
                />

                {/* Supabase Anon Key (Supabase 익명 키) */}
                <ApiKeyRow
                  label="Supabase Anon Key"
                  keyValue="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.••••••••••••••••••••••••••••••••"
                />
              </div>

              {/* Rotate keys CTA (키 교체 CTA) */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Need to rotate a key? Update the value in your server environment variables
                  and redeploy. Changes take effect on the next server start.
                </p>
              </div>
            </div>
          )}

          {/* ── Sync Center tab — renders the full SyncCenter module component ─── */}
          {/* (동기화 센터 탭 — 전체 SyncCenter 모듈 컴포넌트 렌더링) */}
          {activeTab === 'sync' && <SyncCenter />}

        </div>

        {/* Card footer — Save Changes (카드 푸터 — 변경사항 저장) */}
        {/* Hidden on API Keys and Sync Center tabs — those tabs manage their own actions */}
        {/* (API 키 탭과 동기화 센터 탭에서는 숨김 — 각 탭이 자체 액션 관리) */}
        {activeTab !== 'api-keys' && activeTab !== 'sync' && (
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800">
            {/* Transient success confirmation (일시적 저장 성공 확인) */}
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" /> Saved!
              </span>
            )}
            <button
              onClick={handleSave}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 active:scale-95"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
