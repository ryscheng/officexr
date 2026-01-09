'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

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
  const { data: session } = useSession();
  const [offices, setOffices] = useState<Office[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOfficeName, setNewOfficeName] = useState('');
  const [newOfficeDescription, setNewOfficeDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOffices();
    fetchInvitations();
  }, []);

  const fetchOffices = async () => {
    try {
      const response = await fetch('/api/offices');
      if (response.ok) {
        const data = await response.json();
        setOffices(data.offices);
      }
    } catch (error) {
      console.error('Error fetching offices:', error);
    }
  };

  const fetchInvitations = async () => {
    try {
      const response = await fetch('/api/invitations');
      if (response.ok) {
        const data = await response.json();
        setInvitations(data.invitations);
      }
    } catch (error) {
      console.error('Error fetching invitations:', error);
    }
  };

  const handleCreateOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/offices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newOfficeName,
          description: newOfficeDescription,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setNewOfficeName('');
        setNewOfficeDescription('');
        setShowCreateForm(false);
        await fetchOffices();
        // Automatically enter the newly created office
        onSelectOffice(data.office.id);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create office');
      }
    } catch (error) {
      setError('An error occurred while creating the office');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async (token: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        const data = await response.json();
        await fetchOffices();
        await fetchInvitations();
        // Automatically enter the newly joined office
        onSelectOffice(data.office.id);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to accept invitation');
      }
    } catch (error) {
      setError('An error occurred while accepting the invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">OfficeXR</h1>
          <p className="text-gray-600">Select or create your virtual office</p>
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
              You haven't joined any offices yet. Create one to get started!
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
