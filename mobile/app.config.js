module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;
  const shopper = variant === 'shopper';
  const rider = variant === 'rider';
  const name = rider
    ? 'Zippzo Rider'
    : shopper ? 'Zippzo Shopper' : 'Zippzo WMS & DS';
  const slug = rider
    ? 'zippzo-rider'
    : shopper ? 'zippzo-shopper' : 'zippzo-operations';
  const packageName = rider
    ? 'com.zippzo.rider'
    : shopper ? 'com.zippzo.shopper' : 'com.zippzo.operations';
  return {
    ...config,
    name,
    slug,
    android: {
      ...config.android,
      package: packageName,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: packageName,
      infoPlist: shopper ? {} : (config.ios?.infoPlist || {}),
    },
    plugins: [
      'expo-font',
      // Field devices reach the API over plain HTTP on the store LAN. Expo
      // ignores `android.usesCleartextTraffic` in app.json, so without this
      // plugin every prebuild silently produced an APK that refused the
      // request ("Cleartext HTTP traffic not permitted") and could not sign in.
      [
        'expo-build-properties',
        { android: { usesCleartextTraffic: true } },
      ],
      // Riders push their position while on duty so the shopper's map and the
      // ETA are live. Shoppers can pin their delivery address with the device
      // GPS, so both builds need the permission - each with its own wording.
      [
        'expo-location',
        {
          locationWhenInUsePermission: shopper
            ? 'Zippzo uses your location only when you choose "Use my current location" to pin a delivery address.'
            : 'Zippzo uses your location while you are delivering so the customer can follow the order.',
        },
      ],
      ...(shopper ? [] : (config.plugins || [])),
    ],
  };
};
