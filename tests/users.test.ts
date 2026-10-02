import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as users from '../electron/services/users';

let db: Db;
let api: ReturnType<typeof createApi>;
beforeEach(() => {
  db = openDb(':memory:');
  api = createApi(db);
});

const owner = () => api.userCreate({ name: 'Mau', role: 'owner', pin: '1234' });

describe('people and sign in', () => {
  it('lets everything through until the first owner is added, as before', async () => {
    expect((await api.sessionState()).enabled).toBe(false);
    await api.saveSettings({ businessName: 'Mau Gharana' });
    await owner();
    expect((await api.sessionState())).toMatchObject({ enabled: true, current: null });
  });

  it('asks for a sign in once there is an owner, and answers to the right PIN only', async () => {
    const o = await owner();
    await expect(api.getSettings()).rejects.toThrow(/Sign in/);
    await expect(api.sessionLogin(o.id, '9999')).rejects.toThrow(/not right/);
    const s = await api.sessionLogin(o.id, '1234');
    expect(s.current).toMatchObject({ name: 'Mau', role: 'owner' });
    await expect(api.getSettings()).resolves.toBeTruthy();
    await api.sessionLogout();
    await expect(api.getSettings()).rejects.toThrow(/Sign in/);
  });

  it('never stores the PIN as typed', async () => {
    const o = await owner();
    const r = db.prepare('SELECT pin_hash, pin_salt FROM users WHERE id = ?').get(o.id) as { pin_hash: string; pin_salt: string };
    expect(r.pin_hash).not.toContain('1234');
    expect(r.pin_hash).toHaveLength(64);
    expect(r.pin_salt).toHaveLength(32);
  });

  it('locks a person out for a minute after five wrong PINs, even if the next one is right', async () => {
    const o = await owner();
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) expect(() => users.checkLogin(db, o.id, '0000', t)).toThrow(/not right/);
    expect(() => users.checkLogin(db, o.id, '0000', t)).toThrow(/Too many/);
    expect(() => users.checkLogin(db, o.id, '1234', t + 1000)).toThrow(/Too many/);
    expect(users.checkLogin(db, o.id, '1234', t + users.LOCK_MS + 1).name).toBe('Mau');
  });

  it('keeps staff out of settings, backups, cancelling and profit, but lets them sell', async () => {
    const o = await owner();
    const st = await api.sessionLogin(o.id, '1234').then(() => api.userCreate({ name: 'Ravi', role: 'staff', pin: '5678' }));
    await api.sessionLogout();
    await api.sessionLogin(st.id, '5678');
    for (const call of [() => api.saveSettings({}), () => api.backupNow(), () => api.auditList(), () => api.usersList(), () => api.reportMargin({ from: '2026-04-01', to: '2026-10-01' }, 'fabric'), () => api.invoiceCancel('x', 'y')]) {
      await expect(call()).rejects.toThrow(/Only an owner/);
    }
    await expect(api.getSettings()).resolves.toBeTruthy();
    await expect(api.designsList()).resolves.toEqual([]);
  });

  it('writes who did it in the activity log', async () => {
    const o = await owner();
    await api.sessionLogin(o.id, '1234');
    await api.saveSettings({ businessName: 'Mau Gharana' });
    const log = await api.auditList();
    expect(log.find((e) => e.action === 'saveSettings')?.actor).toBe('Mau');
  });

  it('will not remove, demote or switch off the last owner, and a switched off person cannot sign in', async () => {
    const o = await owner();
    await api.sessionLogin(o.id, '1234');
    await expect(api.userUpdate(o.id, { role: 'staff' })).rejects.toThrow(/at least one/);
    await expect(api.userUpdate(o.id, { active: false })).rejects.toThrow(/at least one/);
    await expect(api.userRemove(o.id)).rejects.toThrow(/at least one/);
    const st = await api.userCreate({ name: 'Ravi', role: 'staff', pin: '5678' });
    await api.userUpdate(st.id, { active: false });
    await api.sessionLogout();
    await expect(api.sessionLogin(st.id, '5678')).rejects.toThrow(/not right/);
    expect((await api.sessionState()).people.map((p) => p.name)).toEqual(['Mau']);
  });

  it('checks names and PINs, and signs a person out when they are removed', async () => {
    const o = await owner();
    await api.sessionLogin(o.id, '1234');
    await expect(api.userCreate({ name: 'mau', role: 'staff', pin: '1111' })).rejects.toThrow(/already someone/);
    await expect(api.userCreate({ name: 'Ravi', role: 'staff', pin: '12' })).rejects.toThrow(/4 to 8 digits/);
    const o2 = await api.userCreate({ name: 'Sita', role: 'owner', pin: '4321' });
    await api.sessionLogout();
    await api.sessionLogin(o2.id, '4321');
    await api.userRemove(o.id);
    await api.userSetPin(o2.id, '8888');
    await api.sessionLogout();
    await expect(api.sessionLogin(o2.id, '4321')).rejects.toThrow(/not right/);
    expect((await api.sessionLogin(o2.id, '8888')).current?.name).toBe('Sita');
  });
});
