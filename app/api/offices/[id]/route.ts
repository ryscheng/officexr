import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { getDataSource } = await import('@/lib/db');
    const { Office } = await import('@/lib/entities/Office');
    const { OfficeUser } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const officeRepo = dataSource.getRepository(Office);
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    const office = await officeRepo.findOne({
      where: { id },
      relations: ['members', 'members.user'],
    });

    if (!office) {
      return NextResponse.json({ error: 'Office not found' }, { status: 404 });
    }

    // Check if user has access to this office
    const userMembership = await officeUserRepo.findOne({
      where: { userId: session.user.id, officeId: id },
    });

    if (!userMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const members = office.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
      joinedAt: m.createdAt,
    }));

    return NextResponse.json({
      office: {
        id: office.id,
        name: office.name,
        description: office.description,
        userRole: userMembership.role,
        members,
        createdAt: office.createdAt,
      },
    });
  } catch (error) {
    console.error('Error fetching office:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { getDataSource } = await import('@/lib/db');
    const { Office } = await import('@/lib/entities/Office');
    const { OfficeUser, OfficeRole } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const officeRepo = dataSource.getRepository(Office);
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    // Check if user has admin or owner access
    const userMembership = await officeUserRepo.findOne({
      where: { userId: session.user.id, officeId: id },
    });

    if (!userMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (
      userMembership.role !== OfficeRole.OWNER &&
      userMembership.role !== OfficeRole.ADMIN
    ) {
      return NextResponse.json(
        { error: 'Only owners and admins can update office settings' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description } = body;

    const office = await officeRepo.findOneBy({ id });

    if (!office) {
      return NextResponse.json({ error: 'Office not found' }, { status: 404 });
    }

    if (name && name.trim() !== '') {
      office.name = name.trim();
    }
    office.description = description?.trim() || null;

    await officeRepo.save(office);

    return NextResponse.json({
      success: true,
      office: {
        id: office.id,
        name: office.name,
        description: office.description,
      },
    });
  } catch (error) {
    console.error('Error updating office:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { getDataSource } = await import('@/lib/db');
    const { Office } = await import('@/lib/entities/Office');
    const { OfficeUser, OfficeRole } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const officeRepo = dataSource.getRepository(Office);
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    // Check if user is the owner
    const userMembership = await officeUserRepo.findOne({
      where: { userId: session.user.id, officeId: id },
    });

    if (!userMembership || userMembership.role !== OfficeRole.OWNER) {
      return NextResponse.json(
        { error: 'Only the owner can delete the office' },
        { status: 403 }
      );
    }

    await officeRepo.delete({ id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting office:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
