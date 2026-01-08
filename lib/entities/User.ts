import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Account } from "./Account";
import { Session } from "./Session";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  name!: string | null;

  @Column({ type: "varchar", unique: true, nullable: true })
  email!: string | null;

  @Column({ type: "timestamp", nullable: true })
  emailVerified!: Date | null;

  @Column({ type: "varchar", nullable: true })
  image!: string | null;

  @Column({ type: "varchar", nullable: true, default: "#3498db" })
  avatarBodyColor!: string | null;

  @Column({ type: "varchar", nullable: true, default: "#ffdbac" })
  avatarSkinColor!: string | null;

  @Column({ type: "varchar", nullable: true, default: "default" })
  avatarStyle!: string | null;

  @Column({ type: "json", nullable: true })
  avatarAccessories!: string[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => Account, (account) => account.user, { cascade: true })
  accounts!: Account[];

  @OneToMany(() => Session, (session) => session.user, { cascade: true })
  sessions!: Session[];
}
