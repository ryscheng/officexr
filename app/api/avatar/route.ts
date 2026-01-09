import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function PUT(request: NextRequest) {
  try {
    const { getAuthOptions } = await import('@/lib/auth');
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { bodyColor, skinColor, style, accessories } = body;

    if (!bodyColor || !skinColor || !style) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { getDataSource } = await import('@/lib/db');
    const { User } = await import('@/lib/entities/User');
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    const user = await userRepo.findOneBy({ id: session.user.id });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update user avatar settings
    user.avatarBodyColor = bodyColor;
    user.avatarSkinColor = skinColor;
    user.avatarStyle = style;
    user.avatarAccessories = accessories || [];

    await userRepo.save(user);

    return NextResponse.json({
      success: true,
      customization: {
        bodyColor: user.avatarBodyColor,
        skinColor: user.avatarSkinColor,
        style: user.avatarStyle,
        accessories: user.avatarAccessories,
      },
    });
  } catch (error) {
    console.error('Error updating avatar settings:', error);
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
    const { User } = await import('@/lib/entities/User');
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    const user = await userRepo.findOneBy({ id: session.user.id });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      customization: {
        bodyColor: user.avatarBodyColor || '#3498db',
        skinColor: user.avatarSkinColor || '#ffdbac',
        style: user.avatarStyle || 'default',
        accessories: user.avatarAccessories || [],
      },
    });
  } catch (error) {
    console.error('Error fetching avatar settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
