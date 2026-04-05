import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, signOut } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

interface Office {
  id: string;
  name: string;
  description: string | null;
  role: string;
  createdAt: string;
}

interface Invitation {
  id: string;
  officeName: string;
  officeDescription: string | null;
  inviterName: string;
  role: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

interface OfficeSelectorProps {
  onSelectOffice: (officeId: string) => void;
}

export default function OfficeSelector({ onSelectOffice }: OfficeSelectorProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [offices, setOffices] = useState<Office[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOfficeName, setNewOfficeName] = useState('');
  const [newOfficeDescription, setNewOfficeDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchOffices();
      fetchInvitations();
    }
  }, [user]);

  const fetchOffices = async () => {
    const { data, error } = await supabase
      .from('office_members')
      .select('role, created_at, offices(id, name, description, created_at)')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching offices:', error);
      return;
    }

    // Cast to any[] because supabase-js v2.50+ returns `never` for joined
    // queries when Relationships are not explicitly defined in the Database type.
    const officeList: Office[] = ((data || []) as any[])
      .filter((row) => row.offices)
      .map((row) => {
        const office = row.offices as { id: string; name: string; description: string | null; created_at: string };
        return {
          id: office.id,
          name: office.name,
          description: office.description,
          role: row.role,
          createdAt: office.created_at,
        };
      });

    setOffices(officeList);
  };

  const fetchInvitations = async () => {
    if (!user?.email) return;

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('invitations')
      .select(`
        id, role, token, expires_at, created_at,
        offices(name, description),
        profiles!invitations_inviter_id_fkey(name)
      `)
      .eq('email', user.email)
      .eq('status', 'pending')
      .gt('expires_at', now);

    if (error) {
      console.error('Error fetching invitations:', error);
      return;
    }

    const invitationList: Invitation[] = ((data || []) as any[]).map((row) => {
      const office = row.offices as { name: string; description: string | null } | null;
      const inviter = row.profiles as { name: string | null } | null;
      return {
        id: row.id,
        officeName: office?.name || 'Unknown Office',
        officeDescription: office?.description || null,
        inviterName: inviter?.name || 'Someone',
        role: row.role,
        token: row.token,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      };
    });

    setInvitations(invitationList);
  };

  const handleCreateOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const officeId = crypto.randomUUID();
      const { error: officeError } = await supabase
        .from('offices')
        .insert({
          id: officeId,
          name: newOfficeName.trim(),
          description: newOfficeDescription.trim() || null,
        });

      if (officeError) throw officeError;

      const { error: memberError } = await supabase.from('office_members').insert({
        office_id: officeId,
        user_id: user.id,
        role: 'owner',
      });

      if (memberError) throw memberError;

      setNewOfficeName('');
      setNewOfficeDescription('');
      setShowCreateForm(false);
      await fetchOffices();
      onSelectOffice(officeId);
    } catch (err) {
      console.error('Error creating office:', err);
      setError('Failed to create office');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async (token: string) => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Get the invitation
      const { data: invitation, error: fetchError } = await supabase
        .from('invitations')
        .select('id, office_id, role')
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (fetchError || !invitation) throw new Error('Invitation not found');

      // Add user to office
      const { error: memberError } = await supabase.from('office_members').insert({
        office_id: invitation.office_id,
        user_id: user.id,
        role: invitation.role,
      });

      if (memberError) throw memberError;

      // Mark invitation as accepted
      await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      await fetchOffices();
      await fetchInvitations();
      onSelectOffice(invitation.office_id);
    } catch (err) {
      console.error('Error accepting invitation:', err);
      setError('Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-8">
        <div className="flex justify-between items-start mb-8">
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">OfficeXR</h1>
            <p className="text-gray-600">Select or create your virtual office</p>
          </div>
          <button
            onClick={() => signOut().then(() => navigate('/login'))}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-3">Pending Invitations</h2>
            <div className="space-y-2">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center"
                >
                  <div>
                    <p className="font-semibold text-gray-800">{invitation.officeName}</p>
                    <p className="text-sm text-gray-600">
                      Invited by {invitation.inviterName} as {invitation.role}
                    </p>
                    {invitation.officeDescription && (
                      <p className="text-sm text-gray-500 mt-1">{invitation.officeDescription}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleAcceptInvitation(invitation.token)}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    Accept
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Your Offices */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">Your Offices</h2>
          {offices.length === 0 ? (
            <p className="text-gray-600 text-center py-4">
              You haven&apos;t joined any offices yet. Create one to get started!
            </p>
          ) : (
            <div className="space-y-2">
              {offices.map((office) => (
                <button
                  key={office.id}
                  onClick={() => onSelectOffice(office.id)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 text-left transition-colors"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">{office.name}</p>
                      {office.description && (
                        <p className="text-sm text-gray-600">{office.description}</p>
                      )}
                    </div>
                    <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                      {office.role}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create New Office */}
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            + Create New Office
          </button>
        ) : (
          <form onSubmit={handleCreateOffice} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Office Name *
              </label>
              <input
                type="text"
                id="name"
                value={newOfficeName}
                onChange={(e) => setNewOfficeName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Awesome Office"
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <textarea
                id="description"
                value={newOfficeDescription}
                onChange={(e) => setNewOfficeDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="A collaborative space for..."
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || !newOfficeName.trim()}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                {loading ? 'Creating...' : 'Create Office'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewOfficeName('');
                  setNewOfficeDescription('');
                  setError(null);
                }}
                className="flex-1 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
