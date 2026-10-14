import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { PasskeysService } from './passkeys.service.js';
import { PasskeysController } from './passkeys.controller.js';
import { AuthService } from './auth.service.js';
import { FirebaseService } from './firebase.service.js';
import { SecurityService } from './security.service.js';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, PasskeysController],
  providers: [AuthService, FirebaseService, SecurityService, PasskeysService],
  exports: [AuthService, SecurityService, JwtModule],
})
export class AuthModule {}
