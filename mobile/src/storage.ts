import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_KEY = 'zippzo_access_token';
const REFRESH_KEY = 'zippzo_refresh_token';
const USER_KEY = 'zippzo_user';
const FACILITY_KEY = 'zippzo_facility';

export async function saveSession(access: string, refresh: string, user: unknown, facility: unknown) {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user ?? null));
  await AsyncStorage.setItem(FACILITY_KEY, JSON.stringify(facility ?? null));
}

export async function readAccess(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function readRefresh(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function readUser(): Promise<any> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function readFacility(): Promise<any> {
  const raw = await AsyncStorage.getItem(FACILITY_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await AsyncStorage.removeItem(USER_KEY);
  await AsyncStorage.removeItem(FACILITY_KEY);
}
