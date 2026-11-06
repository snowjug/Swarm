import { api } from '../api';
import { browser } from './browser';
import { clearByok } from './byokStore';
import { publicApi } from './publicApi';
import { clearTabState, rememberNote } from './tabState';

/**
 * Ends the session, forgets everything this tab holds about the person (the key first), and goes back to the landing
 * page. If the server does not confirm the sign-out, nothing is forgotten but the key, and the failure is passed on.
 */
export async function signOutOfPublic(): Promise<void> {
  clearByok();
  await api.signOut();
  clearTabState();
  rememberNote('signed-out');
  browser.assign('/');
}

/** Deletes the account and everything in it, then clears the tab and returns to the landing page with a line about it. */
export async function deleteAccountForGood(): Promise<void> {
  await publicApi.deleteAccount();
  clearTabState();
  rememberNote('deleted');
  browser.assign('/');
}
