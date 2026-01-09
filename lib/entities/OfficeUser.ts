import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";
import { Office } from "./Office";

export enum OfficeRole {
  OWNER = "owner",
  ADMIN = "admin",
  MEMBER = "member",
}

@Entity("office_users")
export class OfficeUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  officeId!: string;

  @Column({
    type: "varchar",
    enum: OfficeRole,
    default: OfficeRole.MEMBER,
  })
  role!: OfficeRole;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.offices, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @ManyToOne(() => Office, (office) => office.members, { onDelete: "CASCADE" })
  @JoinColumn({ name: "officeId" })
  office!: Office;
}
