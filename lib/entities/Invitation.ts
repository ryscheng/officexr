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
import { OfficeRole } from "./OfficeUser";

export enum InvitationStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  DECLINED = "declined",
  EXPIRED = "expired",
}

@Entity("invitations")
export class Invitation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "uuid" })
  officeId!: string;

  @Column({ type: "uuid" })
  inviterId!: string;

  @Column({
    type: "varchar",
    enum: OfficeRole,
    default: OfficeRole.MEMBER,
  })
  role!: OfficeRole;

  @Column({ type: "varchar", length: 255, unique: true })
  token!: string;

  @Column({
    type: "varchar",
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status!: InvitationStatus;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => Office, { onDelete: "CASCADE" })
  @JoinColumn({ name: "officeId" })
  office!: Office;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "inviterId" })
  inviter!: User;
}
