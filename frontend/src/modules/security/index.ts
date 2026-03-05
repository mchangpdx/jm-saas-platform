// Security module public API — exports simulation components for both security modes.
// (보안 모듈 공개 API — 두 가지 보안 모드의 시뮬레이션 컴포넌트 내보내기)

export { PosOverlaySim }    from './components/PosOverlaySim';
export { PreventTheftSim }  from './components/PreventTheftSim';
export { default as SolinkDashboard } from './components/SolinkDashboard'; // Real video overlay dashboard (실제 비디오 오버레이 대시보드)
