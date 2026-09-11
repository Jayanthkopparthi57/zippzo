import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_core.settings')
django.setup()

from django.contrib.auth.models import User
from apps.authentication.models import UserProfile, UserRole
from apps.hr_tracking.models import Employee

users_data = [
    {
        'username': 'admin',
        'email': 'admin@zippzo.com',
        'password': 'admin',
        'first_name': 'Admin',
        'last_name': 'Manager',
        'roles': ['admin', 'manager'],
        'emp_code': 'EMP-001',
        'dept': 'Management',
        'is_super': True
    },
    {
        'username': 'arjun',
        'email': 'arjun.receiver@zippzo.com',
        'password': 'admin',
        'first_name': 'Arjun',
        'last_name': 'Sharma',
        'roles': ['receiver'],
        'emp_code': 'EMP-014',
        'dept': 'Inbound Receiving',
        'is_super': False
    },
    {
        'username': 'priya',
        'email': 'priya.qc@zippzo.com',
        'password': 'admin',
        'first_name': 'Priya',
        'last_name': 'Patel',
        'roles': ['quality_checker'],
        'emp_code': 'EMP-022',
        'dept': 'Quality Control',
        'is_super': False
    },
    {
        'username': 'rahul',
        'email': 'rahul.picker@zippzo.com',
        'password': 'admin',
        'first_name': 'Rahul',
        'last_name': 'Kumar',
        'roles': ['picker'],
        'emp_code': 'EMP-035',
        'dept': 'Fulfillment Picking',
        'is_super': False
    },
    {
        'username': 'kiran',
        'email': 'kiran.packer@zippzo.com',
        'password': 'admin',
        'first_name': 'Kiran',
        'last_name': 'Rao',
        'roles': ['packer'],
        'emp_code': 'EMP-048',
        'dept': 'Packing & Dispatch',
        'is_super': False
    },
    {
        'username': 'suresh',
        'email': 'suresh.rider@zippzo.com',
        'password': 'admin',
        'first_name': 'Suresh',
        'last_name': 'Reddy',
        'roles': ['rider'],
        'emp_code': 'EMP-082',
        'dept': 'Fleet Shipping',
        'is_super': False
    }
]

for u in users_data:
    user, created = User.objects.get_or_create(username=u['username'])
    user.email = u['email']
    user.first_name = u['first_name']
    user.last_name = u['last_name']
    user.is_superuser = u['is_super']
    user.is_staff = True
    user.is_active = True
    user.set_password(u['password'])
    user.save()

    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.is_approved_by_admin = True
    profile.save()

    UserRole.objects.filter(user=user).delete()
    for r in u['roles']:
        UserRole.objects.create(user=user, role=r)

    emp, _ = Employee.objects.get_or_create(user=user)
    emp.employee_code = u['emp_code']
    emp.department = u['dept']
    emp.is_clocked_in = True
    emp.save()

    print(f"✓ Configured user: {u['username']} -> {u['email']}")

print("All organisation users initialized successfully.")
