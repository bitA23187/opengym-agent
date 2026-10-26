// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,beforeEach,afterEach,vi} from 'vitest'
import DailyHealth from './DailyHealth.jsx'
import {useStore} from '../store/useStore.js'
import {api} from '../lib/api.js'
import {useHealthKitClient} from '../lib/useHealthKitClient.js'
import {launchHealthShortcut} from '../lib/health-shortcut.js'
const platform=vi.hoisted(()=>({mobile:false}))
vi.mock('../lib/mobile.js',async importOriginal=>({...await importOriginal(),get MOBILE(){return platform.mobile}}))
vi.mock('../lib/health-shortcut.js',()=>({launchHealthShortcut:vi.fn(async()=>{})}))
vi.mock('../lib/useHealthKitClient.js',()=>({useHealthKitClient:vi.fn(()=>false)}))
vi.mock('../lib/healthkit.js',()=>({healthKitStatus:vi.fn(async()=>({available:true,enabled:true})),syncHealthKit:vi.fn(),enableHealthKit:vi.fn(),disableHealthKit:vi.fn()}))
vi.mock('react-router-dom',()=>({Link:({to,children,...props})=><a href={to} {...props}>{children}</a>,useNavigate:()=>vi.fn(),useLocation:()=>({state:null})}))
vi.mock('../lib/api.js',()=>({api:vi.fn(),appBase:()=>''}))
vi.mock('../sheets.jsx',()=>({confirmSheet:vi.fn()}))
let host,root,previous
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;previous=useStore.getState().user;host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.clearAllMocks();useHealthKitClient.mockReturnValue(false);platform.mobile=false;vi.spyOn(navigator,'userAgent','get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')})
afterEach(()=>{act(()=>root.unmount());host.remove();useStore.setState({user:previous});vi.restoreAllMocks()})
it.each([
 ['Android browser',false,'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Mobile Safari/537.36'],
 ['Android app',true,'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Mobile Safari/537.36'],
 ['Mac browser',false,'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'],
 ['Windows browser',false,'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'],
 ['iPad browser',false,'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'],
 ['native build with iPhone user agent',true,'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
])('hides the entire shortcut panel but preserves health trends on %s',async(_label,mobile,userAgent)=>{
 platform.mobile=mobile;vi.spyOn(navigator,'userAgent','get').mockReturnValue(userAgent)
 api.mockResolvedValue({days:[{date:new Date().toISOString().slice(0,10),restingHeartRate:{value:55}}]});useStore.setState({user:{id:'alice'}})
 await act(async()=>root.render(<DailyHealth/>))
 expect(host.textContent).not.toContain('Sleep and recovery sync')
 expect(host.textContent).not.toContain('Sync sleep and recovery')
 expect(host.querySelector('a[href*="shortcuts"]')).toBeNull()
 expect(host.querySelector('[aria-label="Information about Sleep and recovery sync"]')).toBeNull()
 expect(host.querySelector('.health-metric').textContent).toContain('55')
 expect(api.mock.calls.some(([path])=>path.startsWith('/api/daily-health?'))).toBe(true)
 expect(launchHealthShortcut).not.toHaveBeenCalled()
})
it('keeps the shortcut action available in iPhone browsers',async()=>{
 api.mockResolvedValue({days:[]});useStore.setState({user:{id:'alice'}})
 await act(async()=>root.render(<DailyHealth/>))
 expect(host.querySelector('a[href*="shortcuts/daily-health/v5"]')).not.toBeNull()
 const sync=[...host.querySelectorAll('button')].find(button=>button.textContent==='Sync sleep and recovery')
 await act(async()=>sync.click())
 expect(launchHealthShortcut).toHaveBeenCalledWith('OpenGym 日常健康同步')
})
it('guest never requests health data or credentials',async()=>{useStore.setState({user:null});await act(async()=>root.render(<DailyHealth/>));expect(host.textContent).toContain('Sign in');expect(api).not.toHaveBeenCalled()})
it('keeps iPhone trends focused on health data without duplicating the home sync control',async()=>{
 useHealthKitClient.mockReturnValue(true)
 api.mockResolvedValue({days:[],connected:true});useStore.setState({user:{id:'alice'}})
 await act(async()=>root.render(<DailyHealth/>))
 expect(host.querySelector('[aria-label="Back"]')).not.toBeNull()
 expect(host.textContent).not.toContain('Enable automatic sync')
 expect(host.textContent).not.toContain('Sync sleep and recovery')
 expect(host.querySelector('a[href*="shortcuts"]')).toBeNull()
})
it('delayed old account response never appears after switching accounts',async()=>{
 let resolveOld
 const old=new Promise(r=>{resolveOld=r})
 api.mockImplementation(path=>path.includes('connection')?Promise.resolve({connected:false}):old)
 useStore.setState({user:{id:'old'}});await act(async()=>root.render(<DailyHealth/>))
 api.mockImplementation(path=>Promise.resolve(path.includes('connection')?{connected:false}:{days:[]}))
 await act(async()=>useStore.setState({user:{id:'new'}}))
 await act(async()=>resolveOld({days:[{date:'2026-10-23',restingHeartRate:{value:123,count:1,sources:['OLD PRIVATE SOURCE']},hrv:null,sleep:null}]}))
 expect(host.textContent).not.toContain('OLD PRIVATE SOURCE');expect(host.textContent).not.toContain('123')
})
it('does not request credentials and keeps per-day sample prose out of the trends page',async()=>{
 api.mockImplementation(path=>Promise.resolve(path.includes('connection')?{connected:true}:{days:[{date:'2026-10-23',restingHeartRate:{value:55,count:9,sources:['PRIVATE SOURCE']},hrv:{value:60,count:91,sources:['PRIVATE SOURCE']},sleep:null}]}));useStore.setState({user:{id:'alice'}})
 await act(async()=>root.render(<DailyHealth/>));
 expect(api.mock.calls.some(([path])=>path==='/api/heart-rate/connection')).toBe(false)
 expect(api.mock.calls.some(([path])=>path==='/api/daily-health/connection')).toBe(false)
 expect(host.textContent).not.toContain('Manage health upload credential')
 expect(host.textContent).not.toContain('PRIVATE SOURCE')
 expect(host.textContent).not.toContain('91 samples')
 expect(host.textContent).not.toContain('Daily median')
 expect(host.querySelector('[aria-label="Information about Sleep and recovery"]')).not.toBeNull()
 expect(host.querySelector('textarea')).toBe(null)
 expect(host.querySelector('a[href*="daily-health/v5"]').href).toContain('/daily-health/v5/')
})
it('renders selectable sleep stages with an honest missing-details fallback',async()=>{
 const sleep={minutes:120,mainMinutes:120,start:'2026-10-22T16:00:00Z',end:'2026-10-22T18:00:00Z',additionalSessions:0,stageMinutes:{asleepDeep:30,asleepCore:90},timeline:[{start:'2026-10-22T16:00:00Z',end:'2026-10-22T16:30:00Z',category:'asleepDeep'}]};
 api.mockImplementation(path=>Promise.resolve(path.includes('connection')?{connected:true}:{days:[{date:'2026-10-22',sleep:{...sleep,stageMinutes:undefined,timeline:undefined}},{date:'2026-10-23',sleep}]}));
 useStore.setState({user:{id:'alice'}});await act(async()=>root.render(<DailyHealth/>));
 expect(host.querySelector('[aria-label="Sleep stage timeline"]')).not.toBeNull();expect(host.querySelector('.sleep-asleepDeep title').textContent).toContain('Deep sleep');
 const select=host.querySelector('select');await act(async()=>{select.value='2026-10-22';select.dispatchEvent(new Event('change',{bubbles:true}))});
 expect(host.textContent).toContain('Stage details were not uploaded');expect(host.querySelector('[aria-label="Sleep stage timeline"]')).toBeNull();
});
it('links calendar selection to daily details and fetches at least 30 days even for 7-day recovery trends',async()=>{
 const {todayISO}=await import('../lib/format.js'),date=todayISO(),previous=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10)
 api.mockImplementation(path=>Promise.resolve(path.includes('connection')?{connected:true}:{days:[{date,sleep:{minutes:540,mainMinutes:480,start:date+'T00:00:00Z',end:date+'T08:00:00Z',timeline:[{start:date+'T00:00:00Z',end:date+'T08:00:00Z',category:'asleepCore'}]}}]}));useStore.setState({user:{id:'alice'}})
 await act(async()=>root.render(<DailyHealth/>));expect(host.querySelector('.sleep-daily-value').textContent).toContain('9 h')
 await act(async()=>host.querySelector(`[data-sleep-day="${previous}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true})))
 expect(host.querySelector('.sleep-daily-value').textContent).toBe('—');expect(host.querySelector('[aria-label="Sleep stage timeline"]')).toBeNull()
 const trendSeven=[...host.querySelectorAll('.health-toolbar button')].find(el=>el.textContent==='7 days');await act(async()=>trendSeven.click())
 const query=api.mock.calls.map(([path])=>path).filter(path=>path.startsWith('/api/daily-health?')).at(-1),params=new URLSearchParams(query.split('?')[1])
 expect((Date.parse(params.get('to'))-Date.parse(params.get('from')))/86400000).toBe(29)
})
