import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventMatches } from './EventMatches';
import { Ranking } from './Ranking';
import { currentMonth, type ClubMatch, type MatchDetail, type RankingDetail } from './lib/api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const players = ['ต้น', 'เมย์', 'โบว์', 'บอย'].map((nickname, i) => ({ id: 'player-' + i, nickname }));
const match: ClubMatch = { id:'match', teamA:players.slice(0,2), teamB:players.slice(2), scoreA:4, scoreB:2, createdBy:players[0], updatedBy:players[0], createdAt:1, updatedAt:1, version:1, voided:false, canEdit:true };
const data: MatchDetail = { matches:[], players, canRecord:true };
function props(cancelled = false) { return { event:{id:'e',cancelled}, onError:vi.fn(), onWorking:vi.fn(), notify:vi.fn(), onChanged:vi.fn() }; }
async function fillMatch() {
  const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:'+ บันทึกผล'}));
  for (const [i,p] of players.entries()) {
    const input=screen.getByRole('combobox',{name:`ทีม ${i<2?'A':'B'} ผู้เล่น ${i%2+1}`});
    await user.click(input); await user.type(input,p.nickname);
    await user.click(await screen.findByRole('option',{name:new RegExp(p.nickname)}));
  }
  fireEvent.change(screen.getByLabelText('สกอร์ ทีม A – ทีม B'),{target:{value:'4-2'}});
  return user;
}

test('match form retains all choices after failure and retries with the same request identity', async () => {
  const requests: Record<string,unknown>[]=[]; let failing=true;
  vi.stubGlobal('fetch',vi.fn(async (_path:string,options:RequestInit={}) => {
    if (options.method === 'POST') {
      requests.push(JSON.parse(String(options.body)));
      return failing ? Response.json({message:'ลองอีกครั้ง'},{status:500}) : Response.json({...data,matches:[match]},{status:201});
    }
    return Response.json(data);
  }));
  const callbacks=props(); render(<EventMatches {...callbacks} />);
  const user=await fillMatch();
  expect(screen.getByRole('option',{name:'5–5 · เสมอ'})).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('สกอร์ ทีม A – ทีม B'),'6-4');
  await user.click(screen.getByRole('button',{name:'บันทึกผล'}));
  expect((await screen.findByRole('alert')).textContent).toBe('ลองอีกครั้ง');
  expect((screen.getByLabelText('สกอร์ ทีม A – ทีม B') as HTMLSelectElement).value).toBe('6-4');
  players.forEach((p,i)=>expect((screen.getByRole('combobox',{name:`ทีม ${i<2?'A':'B'} ผู้เล่น ${i%2+1}`}) as HTMLInputElement).value).toBe(p.nickname));
  failing=false; await user.click(screen.getByRole('button',{name:'บันทึกผล'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'+ บันทึกผล'})));
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  expect(requests[1]).toMatchObject({teamA:['player-0','player-1'],teamB:['player-2','player-3'],scoreA:6,scoreB:4});
  expect(callbacks.onChanged).toHaveBeenCalledOnce();
  expect(screen.getByText('ทีม A ชนะ · ผู้ชนะคนละ +3 แต้ม')).toBeTruthy();
});

test('duplicate result needs explicit rematch confirmation; voided history cannot be edited', async () => {
  const requests: Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async (_path:string,options:RequestInit={}) => {
    if (options.method==='POST') {
      const fields=JSON.parse(String(options.body)); requests.push(fields);
      if (!fields.confirmDuplicate) return Response.json({message:'มีผลคล้ายกัน',code:'duplicate-match'},{status:409});
      return Response.json({...data,matches:[{...match,voided:true,canEdit:false}]});
    }
    return Response.json(data);
  }));
  const callbacks=props(); render(<EventMatches {...callbacks} />);
  const user=await fillMatch(); await user.click(screen.getByRole('button',{name:'บันทึกผล'}));
  await user.click(await screen.findByRole('button',{name:'ยืนยันว่าเป็นคนละแมตช์'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests[1]).toMatchObject({confirmDuplicate:true,requestId:requests[0].requestId});
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(screen.getByText('ยกเลิกผล · ไม่นับแต้ม')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/แก้ผล/})).toBeNull();
});

test('cancelled event permits correcting existing matches, preserves version checks, and confirms voiding', async () => {
  let current={...data,canRecord:false,matches:[match]};
  const requests: {method:string;data:Record<string,unknown>}[]=[];
  vi.stubGlobal('fetch',vi.fn(async (_path:string,options:RequestInit={}) => {
    if (options.method==='PATCH') {
      const fields=JSON.parse(String(options.body)); requests.push({method:'PATCH',data:fields});
      current={...current,matches:[{...match,scoreA:3,scoreB:3,version:2,updatedBy:players[1]}]};
    }
    if (options.method==='DELETE') { requests.push({method:'DELETE',data:JSON.parse(String(options.body))}); current={...current,matches:[{...current.matches[0],voided:true,canEdit:false,version:3}]}; }
    return Response.json(current);
  }));
  render(<EventMatches {...props(true)} />); const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:/แก้ผล/}));
  expect(screen.queryByRole('button',{name:'+ บันทึกผล'})).toBeNull();
  fireEvent.change(screen.getByLabelText('สกอร์ ทีม A – ทีม B'),{target:{value:'3-3'}});
  await user.click(screen.getByRole('button',{name:'บันทึกการแก้ผล'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests[0].data).toMatchObject({version:1,scoreA:3,scoreB:3});
  await user.click(screen.getByRole('button',{name:/ยกเลิกผล ต้น/}));
  expect(requests).toHaveLength(1);
  await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'ยืนยันยกเลิกผล'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests[1]).toEqual({method:'DELETE',data:{version:2}});
  expect(screen.getByText('ยกเลิกผล · ไม่นับแต้ม')).toBeTruthy();
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'อัปเดตผล'})));
});

test('ranking shows shared places, zero-point participants and an unranked member, and switches months', async () => {
  const board: RankingDetail={month:currentMonth(),months:['2026-09'],mine:null,standings:[
    {id:'a',nickname:'ต้น',rank:1,points:3,played:2,wins:1,draws:0,losses:1,winPercent:50},
    {id:'b',nickname:'เมย์',rank:1,points:3,played:2,wins:1,draws:0,losses:1,winPercent:50},
    {id:'c',nickname:'โบว์',rank:3,points:0,played:2,wins:0,draws:0,losses:2,winPercent:0}
  ]};
  vi.stubGlobal('fetch',vi.fn(async (path:string) => Response.json(path.endsWith('2026-09') ? {...board,month:'2026-09',standings:[]} : board)));
  render(<Ranking member={{id:'none',nickname:'ยังไม่เล่น'}} onBack={vi.fn()} onError={vi.fn()} />);
  await screen.findByText('ยังไม่มีแมตช์เดือนนี้');
  const list=screen.getByRole('list',{name:'ตารางอันดับ'});
  expect(within(list).getAllByLabelText('อันดับ 1')).toHaveLength(2);
  expect(within(list).getByLabelText('อันดับ 3')).toBeTruthy();
  expect(within(list).getByText('0')).toBeTruthy();
  expect(within(list).getByText('ชนะ 0%')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('รอบอันดับ'),{target:{value:'2026-09'}});
  expect(await screen.findByText('ยังไม่มีผลแมตช์ในเดือนนี้')).toBeTruthy();
});
