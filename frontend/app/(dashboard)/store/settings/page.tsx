// Store Settings page — four-tab professional settings UI for store-role users:
//   Profile, Store Info, Wi-Fi / Amenities, and Sync Center.
// Sync Center tab renders the SyncCenter component for Expert Mode (Method B) POS sync.
// All fields are controlled inputs that simulate an editable form.
// A "Save Changes" button with visual feedback is provided per non-sync tab.
// (스토어 설정 페이지 — 매장 역할 사용자를 위한 네 탭의 전문적인 설정 UI:
//  프로필, 매장 정보, Wi-Fi / 편의시설, 동기화 센터.
//  동기화 센터 탭은 전문가 모드(방법 B) POS 동기화를 위한 SyncCenter 컴포넌트 렌더링.
//  모든 필드는 편집 가능한 폼을 시뮬레이션하는 제어 입력.
//  동기화 센터를 제외한 탭에 시각적 피드백이 있는 "변경사항 저장" 버튼 제공)

'use client';

import { useState } from 'react';
import {
  User,
  Store,
  Wifi,
  Save,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  Clock,
  Lock,
  Coffee,
  Tv,
  Car,
  RefreshCw,
}                   from 'lucide-react';
import { SyncCenter } from '@/modules/settings/components/SyncCenter';

// Tab identifier type — includes the Sync Center tab (탭 식별자 타입 — 동기화 센터 탭 포함)
type Tab = 'profile' | 'store-info' | 'amenities' | 'sync';

// ── Small reusable input (재사용 가능한 소형 입력) ───────────────────────────
function Field({
  label,
  value,
  onChange,
  icon: Icon,
  type = 'text',
  placeholder = '',
}: {
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  icon:         React.ComponentType<{ className?: string }>;
  type?:        string;
  placeholder?: string;
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
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-800 shadow-sm transition placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>
    </div>
  );
}

// ── Toggle switch for amenity booleans (편의시설 불리언용 토글 스위치) ─────────
function Toggle({
  label,
  checked,
  onChange,
  icon: Icon,
}: {
  label:    string;
  checked:  boolean;
  onChange: (v: boolean) => void;
  icon:     React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 ${checked ? 'text-indigo-500' : 'text-gray-400'}`} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
          checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StoreSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [saved,     setSaved    ] = useState(false);

  // Profile tab state (프로필 탭 상태)
  const [ownerName,  setOwnerName ] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');

  // Store Info tab state (매장 정보 탭 상태)
  const [storeName,    setStoreName   ] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone,   setStorePhone  ] = useState('');
  const [storeTimezone, setStoreTimezone] = useState('America/Los_Angeles');

  // Amenities tab state (편의시설 탭 상태)
  const [wifiName,      setWifiName     ] = useState('');
  const [wifiPassword,  setWifiPassword ] = useState('');
  const [hasParking,    setHasParking   ] = useState(false);
  const [hasTv,         setHasTv        ] = useState(false);
  const [hasCoffee,     setHasCoffee    ] = useState(false);
  const [hasAccessible, setHasAccessible] = useState(false);

  // Show a brief "Saved!" confirmation then reset after 2.5 seconds.
  // (2.5초 후 초기화되는 짧은 "저장됨!" 확인 표시)
  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Tab definitions with icons and labels — Sync Center is the fourth tab
  // (아이콘과 레이블이 있는 탭 정의 — 동기화 센터는 네 번째 탭)
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'profile',    label: 'Profile',           icon: User       },
    { id: 'store-info', label: 'Store Info',         icon: Store      },
    { id: 'amenities',  label: 'Wi-Fi / Amenities',  icon: Wifi       },
    { id: 'sync',       label: 'Sync Center',        icon: RefreshCw  },
  ];

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your store profile, location details, and guest amenities.
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

        {/* Tab content area (탭 콘텐츠 영역) */}
        <div className="p-6">

          {/* ── Profile tab (프로필 탭) ──────────────────────────────────────── */}
          {activeTab === 'profile' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Owner contact information associated with this store account.
              </p>

              {/* Avatar placeholder with initial (이니셜이 있는 아바타 플레이스홀더) */}
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-xl font-bold text-white shadow-md ring-4 ring-indigo-100 dark:ring-indigo-900/30">
                  {ownerName.charAt(0).toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {ownerName || 'Store Owner'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Store Owner</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Full Name"    value={ownerName}  onChange={setOwnerName}  icon={User}  placeholder="e.g. Jane Kim"       />
                <Field label="Email"        value={ownerEmail} onChange={setOwnerEmail} icon={Mail}  placeholder="owner@restaurant.com" type="email" />
                <Field label="Phone"        value={ownerPhone} onChange={setOwnerPhone} icon={Phone} placeholder="+1 (555) 000-0000"    />
              </div>
            </div>
          )}

          {/* ── Store Info tab (매장 정보 탭) ────────────────────────────────── */}
          {activeTab === 'store-info' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Business details displayed to guests and used by the AI voice assistant.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Store Name"   value={storeName}     onChange={setStoreName}     icon={Store}  placeholder="e.g. JM Bistro"             />
                <Field label="Phone"        value={storePhone}    onChange={setStorePhone}    icon={Phone}  placeholder="+1 (555) 000-0000"           />
              </div>

              <Field label="Address"       value={storeAddress}  onChange={setStoreAddress}  icon={MapPin} placeholder="123 Main St, Los Angeles, CA 90001" />

              {/* Timezone selector (시간대 선택기) */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Timezone
                </label>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <select
                    value={storeTimezone}
                    onChange={(e) => setStoreTimezone(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Honolulu">Hawaii Time (HT)</option>
                    <option value="America/Anchorage">Alaska Time (AKT)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Wi-Fi / Amenities tab (Wi-Fi / 편의시설 탭) ──────────────────── */}
          {activeTab === 'amenities' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Guest amenities that the AI voice assistant can mention when asked.
              </p>

              {/* Wi-Fi credentials section (Wi-Fi 자격 증명 섹션) */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <Wifi className="h-3.5 w-3.5" /> Wi-Fi Credentials
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Network Name (SSID)" value={wifiName}     onChange={setWifiName}     icon={Wifi} placeholder="e.g. JM_Guest"       />
                  <Field label="Password"            value={wifiPassword} onChange={setWifiPassword} icon={Lock} placeholder="Wi-Fi password" type="password" />
                </div>
              </div>

              {/* Amenity toggles (편의시설 토글) */}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Available Amenities
                </p>
                <Toggle label="Free Parking"       checked={hasParking}    onChange={setHasParking}    icon={Car}     />
                <Toggle label="Televisions"        checked={hasTv}         onChange={setHasTv}         icon={Tv}      />
                <Toggle label="Coffee / Beverages" checked={hasCoffee}     onChange={setHasCoffee}     icon={Coffee}  />
                <Toggle label="ADA Accessible"     checked={hasAccessible} onChange={setHasAccessible} icon={CheckCircle2} />
              </div>
            </div>
          )}
          {/* ── Sync Center tab — renders the full SyncCenter module component ─── */}
          {/* (동기화 센터 탭 — 전체 SyncCenter 모듈 컴포넌트 렌더링) */}
          {activeTab === 'sync' && <SyncCenter />}

        </div>

        {/* Card footer — Save Changes button; hidden on Sync Center tab which manages its own actions */}
        {/* (카드 푸터 — 변경사항 저장 버튼; 자체 액션을 관리하는 동기화 센터 탭에서는 숨김) */}
        {activeTab !== 'sync' && (
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
