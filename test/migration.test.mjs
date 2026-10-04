import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

for (const guestSchema of [false, true]) test('cost migration preserves WAL data and survives restart, starting with ' + (guestSchema ? 'guest members' : 'legacy members'), () => {
  const directory=mkdtempSync(join(tmpdir(),'sks-migration-')), path=join(directory,'club.sqlite');
  const legacy=new DatabaseSync(path);
  legacy.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE members(id TEXT PRIMARY KEY,line_id TEXT ${guestSchema ? '' : 'NOT NULL'} UNIQUE,nickname TEXT${guestSchema ? ',guest_event_id TEXT REFERENCES events(id)' : ''});
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),expires INTEGER NOT NULL);
    CREATE TABLE events(id TEXT PRIMARY KEY,organizer_id TEXT NOT NULL REFERENCES members(id),title TEXT,venue TEXT,date TEXT,start TEXT,end TEXT,courts INTEGER,court_names TEXT,capacity INTEGER,cancelled INTEGER);
    CREATE TABLE registrations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT REFERENCES events(id),member_id TEXT REFERENCES members(id),UNIQUE(event_id,member_id));
    CREATE INDEX registrations_event ON registrations(event_id,sequence);
    CREATE TABLE event_payments(event_id TEXT REFERENCES events(id),member_id TEXT REFERENCES members(id),paid INTEGER,PRIMARY KEY(event_id,member_id));
    INSERT INTO members(id,line_id,nickname) VALUES ('owner','line-owner','ผู้จัด'),('player','line-player','เพื่อน');
    INSERT INTO sessions VALUES ('session','owner',9999999999999);
    INSERT INTO events VALUES ('event','owner','นัดเดิม','สนาม','2026-10-10','18:00','20:00',2,'1,2',1,0);
    INSERT INTO registrations VALUES (42,'event','player'),(45,'event','owner');
    INSERT INTO event_payments VALUES ('event','player',1),('event','owner',0);`);
  const tables=['members','sessions','events','registrations','event_payments','sqlite_sequence'];
  const before=Object.fromEntries(tables.map(table=>[table,legacy.prepare('SELECT * FROM '+table).all().map(row=>({...row}))]));
  const startup=()=>execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../server.mjs',import.meta.url).href)})`],{
    env:{...process.env,SKS_DATABASE_PATH:path,SKS_ORIGIN:'https://club.example'},encoding:'utf8'
  });
  assert.match(startup(),/backup created before cost migration/);
  const backups=readdirSync(directory).filter(name=>name.includes('.before-'));
  assert.equal(backups.length,guestSchema?1:2);
  for(const filename of backups) {
    const backup=new DatabaseSync(join(directory,filename));
    for(const table of tables)assert.deepEqual(backup.prepare('SELECT '+Object.keys(before[table][0]).join(',')+' FROM '+table).all().map(row=>({...row})),before[table]);
    assert.equal(backup.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='court_cost_satang'),false);
    backup.close();
  }
  assert.equal(legacy.prepare('PRAGMA table_info(members)').all().find(c=>c.name==='line_id').notnull,0);
  for(const table of tables)assert.deepEqual(legacy.prepare('SELECT '+Object.keys(before[table][0]).join(',')+' FROM '+table).all().map(row=>({...row})),before[table]);
  assert.deepEqual({...legacy.prepare('SELECT court_cost_satang,ball_cost_satang FROM events').get()},{court_cost_satang:null,ball_cost_satang:null});
  assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(),[]);
  for(const table of ['events','sessions','registrations','event_payments']) {
    assert.equal(legacy.prepare('PRAGMA foreign_key_list('+table+')').all().some(key=>key.table==='members'),true);
  }
  legacy.prepare('INSERT INTO members(id,nickname,guest_event_id) VALUES (?,?,?)').run('guest','ชื่อใหม่','event');
  legacy.prepare('INSERT INTO registrations(event_id,member_id) VALUES (?,?)').run('event','guest');
  assert.equal(legacy.prepare('SELECT sequence FROM registrations WHERE member_id=?').get('guest').sequence,46);
  const qr=readFileSync(new URL('../public/sks-logo.png',import.meta.url));
  legacy.prepare('UPDATE events SET court_cost_satang=100000, ball_cost_satang=12550 WHERE id=?').run('event');
  legacy.prepare('INSERT INTO event_payment_qr VALUES (?,?,?)').run('event',qr,'image/png');
  assert.equal(startup(),'');
  assert.equal(readdirSync(directory).filter(name=>name.includes('.before-')).length,backups.length);
  assert.deepEqual({...legacy.prepare('SELECT court_cost_satang,ball_cost_satang FROM events').get()},{court_cost_satang:100000,ball_cost_satang:12550});
  assert.deepEqual(Buffer.from(legacy.prepare('SELECT image FROM event_payment_qr WHERE event_id=?').get('event').image),qr);
  assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(),[]);
  legacy.close();
});
