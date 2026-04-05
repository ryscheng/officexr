import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation';
import { useAuth, signOut } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface Office {
  id: string;
  name: string;
  description: string | null;
  role: 'owner' | 'admin' | 'member';
}

export default function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    supabase
      .from('office_members')
      .select('role, offices(id, name, description)')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) {
          Alert.alert('Error', 'Failed to load offices');
        } else {
          const mapped = (data ?? []).map((row: any) => ({
            id: row.offices.id,
            name: row.offices.name,
            description: row.offices.description,
            role: row.role,
          }));
          setOffices(mapped);
        }
        setLoading(false);
      });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
  };

  const handleJoinOffice = (office: Office) => {
    navigation.navigate('Office', { officeId: office.id, officeName: office.name });
  };

  const handleJoinGlobal = () => {
    navigation.navigate('Office', { officeId: 'global', officeName: 'Global Office' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.greeting}>
          Hello, {user?.user_metadata?.name ?? user?.email ?? 'Guest'}
        </Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.globalButton} onPress={handleJoinGlobal}>
        <Text style={styles.globalButtonText}>Join Global Office</Text>
        <Text style={styles.globalButtonSub}>Open to everyone</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Your Offices</Text>

      {loading ? (
        <ActivityIndicator color="#4285f4" style={{ marginTop: 32 }} />
      ) : offices.length === 0 ? (
        <Text style={styles.emptyText}>
          You haven't joined any offices yet. Use the web app to create or join an office.
        </Text>
      ) : (
        <FlatList
          data={offices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.officeCard}
              onPress={() => handleJoinOffice(item)}
              activeOpacity={0.8}
            >
              <View style={styles.officeInfo}>
                <Text style={styles.officeName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.officeDesc}>{item.description}</Text>
                ) : null}
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{item.role}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: { color: '#fff', fontSize: 16, fontWeight: '600' },
  signOut: { color: '#8888aa', fontSize: 14 },
  globalButton: {
    backgroundColor: '#4285f4',
    borderRadius: 14,
    padding: 20,
    marginBottom: 28,
  },
  globalButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  globalButtonSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 },
  sectionTitle: { color: '#8888aa', fontSize: 13, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  emptyText: { color: '#8888aa', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 32 },
  list: { gap: 12 },
  officeCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  officeInfo: { flex: 1 },
  officeName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  officeDesc: { color: '#8888aa', fontSize: 13, marginTop: 4 },
  roleBadge: { backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { color: '#4285f4', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
});
