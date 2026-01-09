import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { email, officeId, role } = body;

    if (!email || !officeId || !role) {
      return NextResponse.json(
        { error: 'Email, officeId, and role are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    const { getDataSource } = await import('@/lib/db');
    const { OfficeUser, OfficeRole } = await import('@/lib/entities/OfficeUser');
    const { Invitation, InvitationStatus } = await import('@/lib/entities/Invitation');
    const { User } = await import('@/lib/entities/User');

    const dataSource = await getDataSource();
    const officeUserRepo = dataSource.getRepository(OfficeUser);
    const invitationRepo = dataSource.getRepository(Invitation);
    const userRepo = dataSource.getRepository(User);

    // Check if user has permission to invite (owner or admin)
    const userMembership = await officeUserRepo.findOne({
      where: { userId: session.user.id, officeId },
    });

    if (!userMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (
      userMembership.role !== OfficeRole.OWNER &&
      userMembership.role !== OfficeRole.ADMIN
    ) {
      return NextResponse.json(
        { error: 'Only owners and admins can send invitations' },
        { status: 403 }
      );
    }

    // Validate role
    if (role !== OfficeRole.ADMIN && role !== OfficeRole.MEMBER) {
      return NextResponse.json(
        { error: 'Can only invite as admin or member' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    const existingUser = await userRepo.findOne({ where: { email } });
    if (existingUser) {
      const existingMembership = await officeUserRepo.findOne({
        where: { userId: existingUser.id, officeId },
      });
      if (existingMembership) {
        return NextResponse.json(
          { error: 'User is already a member of this office' },
          { status: 400 }
        );
      }
    }

    // Check if there's already a pending invitation
    const existingInvitation = await invitationRepo.findOne({
      where: {
        email,
        officeId,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingInvitation) {
      return NextResponse.json(
        { error: 'An invitation has already been sent to this email' },
        { status: 400 }
      );
    }

    // Create invitation
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const invitation = invitationRepo.create({
      email,
      officeId,
      inviterId: session.user.id,
      role,
      token,
      status: InvitationStatus.PENDING,
      expiresAt,
    });

    await invitationRepo.save(invitation);

    // TODO: Send email with invitation link
    // For now, we'll just return the token in the response
    // In production, you'd send an email with a link like:
    // https://yourapp.com/accept-invitation?token=${token}

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating invitation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { getDataSource } = await import('@/lib/db');
    const { Invitation, InvitationStatus } = await import('@/lib/entities/Invitation');

    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);

    // Get all pending invitations for the user's email
    const invitations = await invitationRepo.find({
      where: {
        email: session.user.email,
        status: InvitationStatus.PENDING,
      },
      relations: ['office', 'inviter'],
      order: { createdAt: 'DESC' },
    });

    // Check if any invitations have expired
    const now = new Date();
    for (const invitation of invitations) {
      if (invitation.expiresAt < now && invitation.status === InvitationStatus.PENDING) {
        invitation.status = InvitationStatus.EXPIRED;
        await invitationRepo.save(invitation);
      }
    }

    const validInvitations = invitations
      .filter((inv) => inv.status === InvitationStatus.PENDING)
      .map((inv) => ({
        id: inv.id,
        officeName: inv.office.name,
        officeDescription: inv.office.description,
        inviterName: inv.inviter.name,
        role: inv.role,
        token: inv.token,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      }));

    return NextResponse.json({ invitations: validInvitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
