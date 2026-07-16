<?php

declare(strict_types=1);

namespace Nette\Security;

class User
{
    public function isInRole(string $role): bool
    {
        return false;
    }

    public function isAllowed(
        mixed $resource = null,
        mixed $privilege = null,
    ): bool {
        return false;
    }
}
