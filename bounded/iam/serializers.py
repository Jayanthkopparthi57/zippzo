from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from .models import User, Session, Role, Device, QRCode, IdempotencyKey


class UserSerializer(serializers.ModelSerializer):
    # Uniqueness is handled in create(): an administrator may register an
    # address that already belongs to a shopper and promote that account.
    # DRF's auto UniqueValidator would reject it before create() runs.
    email = serializers.CharField(validators=[])

    # Write-only: the stored column is `password_hash`, but callers send `password`.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False,
                                     min_length=6, max_length=128,
                                     help_text="Plain text password; stored hashed.")
    site_id = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    site_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role_at_site = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['user_id', 'email', 'phone', 'full_name', 'role', 'status',
                  'last_login_at', 'created_at', 'password', 'site_id', 'site_code', 'role_at_site']
        read_only_fields = ['user_id', 'created_at', 'updated_at', 'last_login_at']

    def validate_email(self, value):
        email = str(value).strip().lower()
        if '@' not in email:
            raise ValidationError('Enter a valid email address.')
        return email

    def validate_password(self, value):
        if value.strip() != value or not value.strip():
            raise ValidationError("Password must not be blank.")
        return value

    def create(self, validated_data):
        import uuid
        from django.db import IntegrityError, transaction

        password = validated_data.pop('password', None)
        site_id = validated_data.pop('site_id', None)
        site_code = validated_data.pop('site_code', None)
        role_at_site = validated_data.pop('role_at_site', None)

        if not password:
            raise ValidationError({'password': "This field is required."})
        validated_data['password_hash'] = make_password(password)

        try:
            with transaction.atomic():
                # A shopper can sign up with the same address an administrator
                # later wants to register as staff. User.email is unique across
                # every role, so a plain create used to 400 here. Promote the
                # existing non-admin account instead: the Customer row and its
                # order history stay intact.
                email = str(validated_data.get('email') or '').strip().lower()
                existing = User.objects.filter(email__iexact=email).first() if email else None
                if existing is not None:
                    if existing.role in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'):
                        raise ValidationError({
                            'email': 'This address belongs to an administrator account.'
                        })
                    for attr in ('full_name', 'phone', 'role', 'status', 'password_hash'):
                        if attr in validated_data:
                            setattr(existing, attr, validated_data[attr])
                    existing.status = 'ACTIVE'
                    existing.save(update_fields=[
                        'full_name', 'phone', 'role', 'status', 'password_hash'])
                    user = existing
                else:
                    user = super().create(validated_data)

                from bounded.network.models import Site, EmployeeSiteAssignment
                target_site = None
                if site_code:
                    target_site = Site.objects.filter(code=site_code).first()
                elif site_id:
                    target_site = Site.objects.filter(site_id=site_id).first()

                if target_site:
                    mode = 'DARKHOUSE' if target_site.site_type == 'DS' else 'WAREHOUSE'
                    role_name = role_at_site or (
                        'STORE_MANAGER' if user.role == 'OPS_MANAGER' else 'OPERATOR')
                    emp_code = user.email.split('@')[0].upper()[:20]
                    has_primary = EmployeeSiteAssignment.objects.filter(
                        user=user, is_primary=True, is_active=True).exists()
                    defaults = {
                        'employee': emp_code, 'mode': mode,
                        'role_at_site': role_name,
                        'is_primary': not has_primary, 'is_active': True,
                    }
                    try:
                        assignment, _ = EmployeeSiteAssignment.objects.get_or_create(
                            user=user, site=target_site, defaults=defaults)
                    except IntegrityError:
                        # employee + site + mode is unique; a different person
                        # may already own that code. Give this account its own.
                        defaults['employee'] = f'{emp_code[:14]}{uuid.uuid4().hex[:5]}'
                        assignment, _ = EmployeeSiteAssignment.objects.get_or_create(
                            user=user, site=target_site, defaults=defaults)
                    if not assignment.is_active:
                        assignment.is_active = True
                        assignment.role_at_site = role_name
                        assignment.save(update_fields=['is_active', 'role_at_site'])
                return user
        except IntegrityError as exc:
            raise ValidationError({
                'email': 'This employee could not be registered. '
                         'Check the email and store assignment and retry.'
            }) from exc

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        site_id = validated_data.pop('site_id', None)
        site_code = validated_data.pop('site_code', None)
        role_at_site = validated_data.pop('role_at_site', None)

        if password:
            instance.password_hash = make_password(password)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update assignment if provided
        from bounded.network.models import Site, EmployeeSiteAssignment
        target_site = None
        if site_code:
            target_site = Site.objects.filter(code=site_code).first()
        elif site_id:
            target_site = Site.objects.filter(site_id=site_id).first()

        asgn = EmployeeSiteAssignment.objects.filter(user=instance).first()
        if target_site:
            mode = 'DARKHOUSE' if target_site.site_type == 'DS' else 'WAREHOUSE'
            role_name = role_at_site or ('STORE_MANAGER' if instance.role == 'OPS_MANAGER' else 'OPERATOR')
            emp_code = instance.email.split('@')[0].upper()[:20]
            if asgn:
                asgn.site = target_site
                asgn.mode = mode
                asgn.role_at_site = role_name
                asgn.save()
            else:
                EmployeeSiteAssignment.objects.create(
                    user=instance,
                    site=target_site,
                    employee=emp_code,
                    mode=mode,
                    role_at_site=role_name,
                    is_primary=True,
                    is_active=True
                )
        elif role_at_site and asgn:
            # Role-only change (no site change): keep the existing site.
            asgn.role_at_site = role_at_site
            asgn.save(update_fields=['role_at_site'])
        return instance

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Add primary assignment info.
        #
        # This used to be one query per row, which is 113 round trips to a
        # managed Postgres for one user list - measured at ~60s. The list
        # action prefetches the active assignments (UserViewSet.list); the
        # fallback keeps single-record responses correct.
        asgn = getattr(instance, 'active_assignments', None)
        if asgn is None:
            from bounded.network.models import EmployeeSiteAssignment
            asgn = (EmployeeSiteAssignment.objects
                    .filter(user=instance, is_active=True)
                    .select_related('site').first())
        else:
            asgn = asgn[0] if asgn else None
        if asgn and asgn.site:
            ret['assigned_site'] = {
                'code': asgn.site.code,
                'name': asgn.site.name,
                'site_type': asgn.site.site_type,
                'role_at_site': asgn.role_at_site,
            }
        else:
            ret['assigned_site'] = None
        return ret


class SessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Session
        fields = ['session_id', 'user', 'token', 'device_fingerprint', 'ip_address', 'is_active', 'expires_at', 'created_at']
        read_only_fields = ['session_id', 'created_at']


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['role_id', 'name', 'description', 'permissions', 'is_system', 'created_at']
        read_only_fields = ['role_id', 'created_at']


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = ['device_id', 'user', 'platform', 'push_token', 'is_active', 'last_seen_at', 'created_at']
        read_only_fields = ['device_id', 'created_at']


class QRCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = QRCode
        fields = ['qr_id', 'code', 'data', 'qr_type', 'expires_at', 'scan_count', 'created_at']
        read_only_fields = ['qr_id', 'created_at']


class IdempotencyKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = IdempotencyKey
        fields = ['key', 'action', 'user_id', 'response_json', 'expires_at', 'created_at']
        read_only_fields = ['key', 'created_at']
