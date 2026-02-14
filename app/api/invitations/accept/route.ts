import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function POST(request: NextRequest) {
  try {
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    const { getDataSource } = await import('@/lib/db');
    const { Invitation, InvitationStatus } = await import('@/lib/entities/Invitation');
    const { OfficeUser } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const invitationRepo = dataSource.getRepository(Invitation);
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    // Find the invitation
    const invitation = await invitationRepo.findOne({
      where: { token },
      relations: ['office'],
    });

    if (!invitation) {
      return NextResponse.json(
        { error: 'Invalid invitation token' },
        { status: 404 }
      );
    }

    // Check if invitation is for the current user's email
    if (invitation.email !== session.user.email) {
      return NextResponse.json(
        { error: 'This invitation is not for your email address' },
        { status: 403 }
      );
    }

    // Check if invitation is still pending
    if (invitation.status !== InvitationStatus.PENDING) {
      return NextResponse.json(
        { error: `Invitation has already been ${invitation.status}` },
        { status: 400 }
      );
    }

    // Check if invitation has expired
    if (invitation.expiresAt < new Date()) {
      invitation.status = InvitationStatus.EXPIRED;
      await invitationRepo.save(invitation);
      return NextResponse.json(
        { error: 'Invitation has expired' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    const existingMembership = await officeUserRepo.findOne({
      where: { userId: session.user.id, officeId: invitation.officeId },
    });

    if (existingMembership) {
      invitation.status = InvitationStatus.ACCEPTED;
      await invitationRepo.save(invitation);
      return NextResponse.json(
        { error: 'You are already a member of this office' },
        { status: 400 }
      );
    }

    // Add user to office
    const officeUser = officeUserRepo.create({
      userId: session.user.id,
      officeId: invitation.officeId,
      role: invitation.role,
    });
    await officeUserRepo.save(officeUser);

    // Mark invitation as accepted
    invitation.status = InvitationStatus.ACCEPTED;
    await invitationRepo.save(invitation);

    return NextResponse.json({
      success: true,
      office: {
        id: invitation.office.id,
        name: invitation.office.name,
        description: invitation.office.description,
        role: invitation.role,
      },
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
