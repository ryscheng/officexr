import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function POST(request: NextRequest) {
  try {
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Office name is required' },
        { status: 400 }
      );
    }

    const { getDataSource } = await import('@/lib/db');
    const { Office } = await import('@/lib/entities/Office');
    const { OfficeUser, OfficeRole } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const officeRepo = dataSource.getRepository(Office);
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    // Create the office
    const office = officeRepo.create({
      name: name.trim(),
      description: description?.trim() || null,
    });
    await officeRepo.save(office);

    // Add the creator as owner
    const officeUser = officeUserRepo.create({
      userId: session.user.id,
      officeId: office.id,
      role: OfficeRole.OWNER,
    });
    await officeUserRepo.save(officeUser);

    return NextResponse.json({
      success: true,
      office: {
        id: office.id,
        name: office.name,
        description: office.description,
        role: OfficeRole.OWNER,
        createdAt: office.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating office:', error);
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

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { getDataSource } = await import('@/lib/db');
    const { OfficeUser } = await import('@/lib/entities/OfficeUser');

    const dataSource = await getDataSource();
    const officeUserRepo = dataSource.getRepository(OfficeUser);

    // Get all offices the user is a member of
    const officeUsers = await officeUserRepo.find({
      where: { userId: session.user.id },
      relations: ['office'],
      order: { createdAt: 'DESC' },
    });

    const offices = officeUsers.map((ou) => ({
      id: ou.office.id,
      name: ou.office.name,
      description: ou.office.description,
      role: ou.role,
      createdAt: ou.office.createdAt,
    }));

    return NextResponse.json({ offices });
  } catch (error) {
    console.error('Error fetching offices:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
