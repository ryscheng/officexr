import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation';
import { useAuth } from '@/hooks/useAuth';

type Props = NativeStackScreenProps<RootStackParamList, 'Office'>;

// The 3D office scene is a WebGL/WebXR application built on Three.js.
// Rather than re-implementing the full rendering pipeline in React Native,
// the native shell embeds the web build in a full-screen WebView and
// injects the Supabase session so the user stays logged in.
//
// Future improvement: migrate OfficeScene to use expo-gl + expo-three
// for a fully native render path.
const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://your-officexr-deployment.vercel.app';

export default function OfficeScreen({ route, navigation }: Props) {
  const { officeId, officeName } = route.params;
  const { session } = useAuth();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build the URL with the office pre-selected.
  const url = `${WEB_APP_URL}?officeId=${encodeURIComponent(officeId)}`;

  // Inject the Supabase auth session into the WebView's localStorage so the
  // web app picks it up without requiring a second login.
  const injectSession = session
    ? `
        (function() {
          const key = 'sb-${new URL(WEB_APP_URL).hostname.split('.')[0]}-auth-token';
          localStorage.setItem(key, ${JSON.stringify(JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
            token_type: 'bearer',
            user: session.user,
          }))});
          true;
        })();
      `
    : 'true;';

  const handleNavigationChange = (event: WebViewNavigation) => {
    // Intercept back-navigation to the login page and pop the native stack.
    if (event.url.includes('/login')) {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button overlay */}
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← {officeName}</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4285f4" />
          <Text style={styles.loadingText}>Loading {officeName}…</Text>
        </View>
      )}

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setLoading(true);
              webviewRef.current?.reload();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webviewRef}
          source={{ uri: url }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) => setError(e.nativeEvent.description)}
          onNavigationStateChange={handleNavigationChange}
          injectedJavaScriptBeforeContentLoaded={injectSession}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // Enable WebGL for Three.js.
          androidLayerType="hardware"
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backButton: { alignSelf: 'flex-start' },
  backButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  webview: { flex: 1, marginTop: 40 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  loadingText: { color: '#8888aa', marginTop: 12, fontSize: 14 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#ff6b6b', textAlign: 'center', marginBottom: 20 },
  retryButton: { backgroundColor: '#4285f4', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 28 },
  retryText: { color: '#fff', fontWeight: '600' },
});
